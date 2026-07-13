// agora-scrape: concurrent multi-page corpus puller for AGORA.
//
// Fans out across HN, Bluesky, Mastodon and Lemmy with pagination, dedupes,
// and bulk-inserts into the Convex deployment via its HTTP function API —
// the reactive UI fills up live while this runs.
//
//	go run ./scraper -q "return to office mandate" -pages 4
package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/json"
	"flag"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

func tsOf(raw string) float64 {
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return float64(time.Now().UnixMilli())
	}
	return float64(t.UnixMilli())
}

type Post struct {
	Author string  `json:"author"`
	Text   string  `json:"text"`
	Score  float64 `json:"score"`
	URL    string  `json:"url,omitempty"`
	TS     float64 `json:"ts"`
}

var (
	deployment = flag.String("deployment", "http://127.0.0.1:3210", "Convex deployment URL")
	query      = flag.String("q", "", "search query (required)")
	pages      = flag.Int("pages", 3, "pages per source")
	dump       = flag.String("dump", "", "also write deduped results as JSON to this file")
	noInsert   = flag.Bool("no-insert", false, "skip Convex insert (use with -dump for cache-only pulls)")
	client     = &http.Client{Timeout: 12 * time.Second}
	tagRe      = regexp.MustCompile(`<[^>]+>|&\w+;`)
	spaceRe    = regexp.MustCompile(`\s+`)
)

var (
	mdLinkRe  = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	mdQuoteRe = regexp.MustCompile(`(?m)^>\s?`)
)

func strip(s string) string {
	s = html.UnescapeString(s)             // &#x27; &amp; …
	s = mdLinkRe.ReplaceAllString(s, "$1") // [text](url) → text
	s = mdQuoteRe.ReplaceAllString(s, "")
	return strings.TrimSpace(spaceRe.ReplaceAllString(tagRe.ReplaceAllString(s, " "), " "))
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) { // never split a multibyte rune
		n--
	}
	return s[:n]
}

// getJSON fetches u and decodes into v, with one retry.
func getJSON(u string, v any) error {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		req, _ := http.NewRequest("GET", u, nil)
		req.Header.Set("User-Agent", "agora-scrape/0.1 (research prototype)")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != 200 {
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			if resp.StatusCode < 500 && resp.StatusCode != 429 {
				return lastErr // 4xx (except 429) won't improve on retry
			}
			time.Sleep(600 * time.Millisecond)
			continue
		}
		return json.Unmarshal(body, v)
	}
	return lastErr
}

func scrapeHN(q string, pages int, out chan<- []Post) {
	for p := 0; p < pages; p++ {
		var res struct {
			Hits []struct {
				Author      string `json:"author"`
				CommentText string `json:"comment_text"`
				Points      *int   `json:"points"`
				ObjectID    string `json:"objectID"`
				CreatedAtI  int64  `json:"created_at_i"`
			} `json:"hits"`
		}
		u := fmt.Sprintf("https://hn.algolia.com/api/v1/search?query=%s&tags=comment&hitsPerPage=100&page=%d",
			url.QueryEscape(q), p)
		if err := getJSON(u, &res); err != nil {
			fmt.Printf("  hn page %d: %v\n", p, err)
			return
		}
		var batch []Post
		for _, h := range res.Hits {
			pts := 0.0
			if h.Points != nil {
				pts = float64(*h.Points)
			}
			batch = append(batch, Post{
				Author: h.Author, Text: clip(strip(h.CommentText), 800), Score: pts,
				URL: "https://news.ycombinator.com/item?id=" + h.ObjectID,
				TS:  float64(h.CreatedAtI) * 1000,
			})
		}
		if len(batch) == 0 {
			return
		}
		out <- batch
	}
}

func scrapeBluesky(q string, pages int, out chan<- []Post) {
	cursor := ""
	for p := 0; p < pages; p++ {
		var res struct {
			Cursor string `json:"cursor"`
			Posts  []struct {
				URI    string `json:"uri"`
				Author struct {
					Handle string `json:"handle"`
				} `json:"author"`
				Record struct {
					Text      string `json:"text"`
					CreatedAt string `json:"createdAt"`
				} `json:"record"`
				LikeCount   float64 `json:"likeCount"`
				RepostCount float64 `json:"repostCount"`
			} `json:"posts"`
		}
		u := fmt.Sprintf("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%s&limit=100&lang=en", url.QueryEscape(q))
		if cursor != "" {
			u += "&cursor=" + url.QueryEscape(cursor)
		}
		if err := getJSON(u, &res); err != nil {
			fmt.Printf("  bluesky page %d: %v\n", p, err)
			return
		}
		var batch []Post
		for _, b := range res.Posts {
			parts := strings.Split(b.URI, "/")
			batch = append(batch, Post{
				Author: b.Author.Handle, Text: clip(b.Record.Text, 800),
				Score: b.LikeCount + b.RepostCount,
				URL:   fmt.Sprintf("https://bsky.app/profile/%s/post/%s", b.Author.Handle, parts[len(parts)-1]),
				TS:    tsOf(b.Record.CreatedAt),
			})
		}
		if len(batch) == 0 {
			return
		}
		out <- batch
		if res.Cursor == "" {
			return
		}
		cursor = res.Cursor
	}
}

type mastoStatus struct {
	ID      string  `json:"id"`
	Content string  `json:"content"`
	URL     string  `json:"url"`
	Created string  `json:"created_at"`
	Lang    string  `json:"language"`
	Favs    float64 `json:"favourites_count"`
	Boosts  float64 `json:"reblogs_count"`
	Account struct {
		Acct string `json:"acct"`
	} `json:"account"`
}

func scrapeMastodon(q string, pages int, out chan<- []Post) {
	maxID := ""
	for p := 0; p < pages; p++ {
		var wrap struct {
			Statuses []mastoStatus `json:"statuses"`
		}
		u := fmt.Sprintf("https://mastodon.social/api/v2/search?type=statuses&limit=40&q=%s", url.QueryEscape(q))
		if maxID != "" {
			u += "&max_id=" + maxID
		}
		if err := getJSON(u, &wrap); err != nil {
			fmt.Printf("  mastodon page %d: %v\n", p, err)
			return
		}
		if len(wrap.Statuses) == 0 {
			return
		}
		var batch []Post
		for _, t := range wrap.Statuses {
			if t.Lang != "" && t.Lang != "en" {
				continue
			}
			batch = append(batch, Post{
				Author: t.Account.Acct, Text: clip(strip(t.Content), 800),
				Score: t.Favs + t.Boosts, URL: t.URL, TS: tsOf(t.Created),
			})
		}
		out <- batch
		maxID = wrap.Statuses[len(wrap.Statuses)-1].ID
	}
}

func scrapeLemmy(q string, pages int, out chan<- []Post) {
	for p := 1; p <= pages; p++ {
		var res struct {
			Comments []struct {
				Comment struct {
					Content   string `json:"content"`
					ApID      string `json:"ap_id"`
					Published string `json:"published"`
				} `json:"comment"`
				Creator struct {
					Name string `json:"name"`
				} `json:"creator"`
				Counts struct {
					Score float64 `json:"score"`
				} `json:"counts"`
			} `json:"comments"`
		}
		u := fmt.Sprintf("https://lemmy.world/api/v3/search?q=%s&type_=Comments&limit=50&sort=TopAll&page=%d",
			url.QueryEscape(q), p)
		if err := getJSON(u, &res); err != nil {
			fmt.Printf("  lemmy page %d: %v\n", p, err)
			return
		}
		if len(res.Comments) == 0 {
			return
		}
		var batch []Post
		for _, c := range res.Comments {
			batch = append(batch, Post{
				Author: c.Creator.Name, Text: clip(strip(c.Comment.Content), 800),
				Score: c.Counts.Score, URL: c.Comment.ApID, TS: tsOf(c.Comment.Published),
			})
		}
		out <- batch
	}
}

// insertBatch bulk-inserts one platform's posts in ≤400-row chunks (the Convex
// mutation hard-rejects >500) and returns the server-confirmed insert count.
func insertBatch(platform string, posts []Post) (int, error) {
	inserted := 0
	for lo := 0; lo < len(posts); lo += 400 {
		hi := min(lo+400, len(posts))
		body, _ := json.Marshal(map[string]any{
			"path":   "ingest:insertScraped",
			"args":   map[string]any{"platform": platform, "query": *query, "posts": posts[lo:hi]},
			"format": "json",
		})
		resp, err := client.Post(*deployment+"/api/mutation", "application/json", bytes.NewReader(body))
		if err != nil {
			return inserted, err
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			return inserted, fmt.Errorf("convex HTTP %d: %s", resp.StatusCode, clip(string(raw), 200))
		}
		var res struct {
			Status string `json:"status"`
			Value  struct {
				Inserted float64 `json:"inserted"`
			} `json:"value"`
			ErrorMessage string `json:"errorMessage"`
		}
		if err := json.Unmarshal(raw, &res); err != nil {
			return inserted, err
		}
		if res.Status != "success" {
			return inserted, fmt.Errorf("convex error: %s", clip(res.ErrorMessage, 200))
		}
		inserted += int(res.Value.Inserted)
	}
	return inserted, nil
}

func writeFile(path string, b []byte) error {
	return os.WriteFile(path, b, 0o644)
}

func main() {
	flag.Parse()
	if *query == "" {
		fmt.Println("usage: go run ./scraper -q \"<query>\" [-pages N] [-deployment URL]")
		return
	}
	start := time.Now()
	sources := map[string]func(string, int, chan<- []Post){
		"hn": scrapeHN, "bluesky": scrapeBluesky, "mastodon": scrapeMastodon, "lemmy": scrapeLemmy,
	}
	var wg sync.WaitGroup
	results := make(map[string][]Post)
	var mu sync.Mutex
	for name, fn := range sources {
		wg.Add(1)
		go func(name string, fn func(string, int, chan<- []Post)) {
			defer wg.Done()
			ch := make(chan []Post, *pages)
			done := make(chan struct{})
			go func() {
				for batch := range ch {
					mu.Lock()
					results[name] = append(results[name], batch...)
					mu.Unlock()
				}
				close(done)
			}()
			fn(*query, *pages, ch)
			close(ch)
			<-done
		}(name, fn)
	}
	wg.Wait()

	// dedupe across all sources by normalized-text hash
	seen := map[[20]byte]bool{}
	deduped := map[string][]Post{}
	total := 0
	for platform, posts := range results {
		total += len(posts)
		for _, p := range posts {
			if len(strings.Fields(p.Text)) < 5 { // junk gate: need at least 5 words
				continue
			}
			h := sha1.Sum([]byte(strings.ToLower(p.Text)))
			if seen[h] {
				continue
			}
			seen[h] = true
			deduped[platform] = append(deduped[platform], p)
		}
	}
	if *dump != "" {
		f, err := json.MarshalIndent(map[string]any{"query": *query, "ts": time.Now().UnixMilli(), "posts": deduped}, "", " ")
		if err == nil {
			err = writeFile(*dump, f)
		}
		if err != nil {
			fmt.Printf("  dump failed: %v\n", err)
		} else {
			fmt.Printf("  dumped to %s\n", *dump)
		}
	}
	inserted := 0
	for platform, unique := range deduped {
		if *noInsert || len(unique) == 0 {
			continue
		}
		n, err := insertBatch(platform, unique)
		inserted += n
		if err != nil {
			fmt.Printf("  %s insert failed after %d rows: %v\n", platform, n, err)
			continue
		}
		fmt.Printf("  %-9s %4d scraped → %4d unique → %4d stored (server deduped)\n",
			platform, len(results[platform]), len(unique), n)
	}
	fmt.Printf("done: %d scraped, %d inserted in %.1fs (concurrent, %d pages/source)\n",
		total, inserted, time.Since(start).Seconds(), *pages)
}
