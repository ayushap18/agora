import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const UA = { "User-Agent": "agora-research/0.1 (hackathon prototype)" };
const strip = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

type RawPost = { platform: string; author: string; text: string; score: number; url?: string; ts: number };

export const start = mutation({
  args: { platform: v.string(), query: v.string() },
  handler: async (ctx, { platform, query }) => {
    const sourceId = await ctx.db.insert("sources", { platform, query, status: "running", count: 0 });
    const fn =
      platform === "reddit" ? internal.ingest.fetchReddit :
      platform === "hn" ? internal.ingest.fetchHN :
      platform === "bluesky" ? internal.ingest.fetchBluesky :
      platform === "mastodon" ? internal.ingest.fetchMastodon : null;
    if (!fn) throw new Error(`unknown platform ${platform} (x is import-only)`);
    await ctx.scheduler.runAfter(0, fn, { sourceId, query });
    return sourceId;
  },
});

export const importX = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const sourceId = await ctx.db.insert("sources", { platform: "x", query: "manual import", status: "running", count: 0 });
    const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 30);
    const posts: RawPost[] = lines.slice(0, 300).map((l, i) => {
      // tolerate "author, text" CSV-ish lines; otherwise whole line is the post
      const m = l.match(/^@?([\w.]{2,20})[,;\t]\s*(.{30,})$/);
      return {
        platform: "x",
        author: m ? m[1] : "imported",
        text: (m ? m[2] : l).slice(0, 800),
        score: 1,
        ts: Date.now() - i * 60000,
      };
    });
    await insertPostRows(ctx, sourceId, posts);
    return { count: posts.length };
  },
});

// FNV-1a over normalized text — cheap content address for cross-run dedupe.
function textHash(text: string): string {
  const norm = text.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ":" + norm.length;
}

function isJunk(text: string): boolean {
  const words = text.replace(/https?:\/\/\S+/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length < 5; // link-only / emoji-only / fragment posts
}

// The single insert path for ALL ingestion (native fetch, X import, Go scraper,
// Ruby cache replay): quality-gates and dedupes by content hash.
async function insertPostRows(ctx: any, sourceId: any, posts: RawPost[]) {
  let inserted = 0, skipped = 0;
  for (const p of posts) {
    if (isJunk(p.text)) { skipped++; continue; }
    const hash = textHash(p.text);
    const dup = await ctx.db.query("posts")
      .withIndex("by_hash", (q: any) => q.eq("hash", hash)).first();
    if (dup) { skipped++; continue; }
    await ctx.db.insert("posts", { sourceId, ...p, hash });
    inserted++;
  }
  await ctx.db.patch(sourceId, { status: "done", count: inserted });
  return { inserted, skipped };
}

export const insertPosts = internalMutation({
  args: { sourceId: v.id("sources"), posts: v.array(v.any()) },
  handler: async (ctx, { sourceId, posts }) => {
    await insertPostRows(ctx, sourceId, posts as RawPost[]);
    const src = await ctx.db.get(sourceId);
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L0", status: "done", progress: 1,
      detail: `${src?.platform}: ${posts.length} posts for "${src?.query}"`,
    });
  },
});

export const markSource = internalMutation({
  args: { sourceId: v.id("sources"), status: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { sourceId, status, error }) => {
    await ctx.db.patch(sourceId, { status, error });
    const src = await ctx.db.get(sourceId);
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L0", status: "failed", progress: 0,
      detail: `${src?.platform} failed: ${error ?? "unknown"}`,
    });
  },
});

async function runFetch(
  ctx: any, sourceId: any, label: string,
  doFetch: () => Promise<RawPost[]>
) {
  await ctx.runMutation(internal.pipeline.log, {
    layer: "L0", status: "running", progress: 0.2, detail: label,
  });
  try {
    const posts = (await doFetch()).filter((p) => p.text.length > 30);
    if (!posts.length) throw new Error("no usable posts returned");
    await ctx.runMutation(internal.ingest.insertPosts, { sourceId, posts });
  } catch (e: any) {
    await ctx.runMutation(internal.ingest.markSource, { sourceId, status: "failed", error: String(e?.message ?? e) });
  }
}

export const fetchReddit = internalAction({
  args: { sourceId: v.id("sources"), query: v.string() },
  handler: async (ctx, { sourceId, query }) => {
    await runFetch(ctx, sourceId, `reddit: ${query}`, async () => {
      const r = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=100&sort=relevance`,
        { headers: UA }
      );
      if (r.ok) {
        const json = await r.json();
        return json.data.children.map((c: any) => ({
          platform: "reddit",
          author: c.data.author ?? "unknown",
          text: (c.data.title + " " + (c.data.selftext ?? "")).slice(0, 800).trim(),
          score: c.data.score ?? 0,
          url: "https://reddit.com" + c.data.permalink,
          ts: (c.data.created_utc ?? 0) * 1000,
        }));
      }
      // Reddit blocks unauthenticated JSON from many networks — try PullPush
      // (free, no-auth Pushshift successor: REAL reddit comments), then Lemmy.
      const pp = await fetch(
        `https://api.pullpush.io/reddit/search/comment/?q=${encodeURIComponent(query)}&size=100`
      ).catch(() => null);
      if (pp?.ok) {
        const pj = await pp.json();
        const rows = (pj.data ?? []).map((c: any) => ({
          platform: "reddit",
          author: c.author ?? "unknown",
          text: String(c.body ?? "").slice(0, 800),
          score: c.score ?? 0,
          url: c.permalink ? "https://reddit.com" + c.permalink : undefined,
          ts: (c.created_utc ?? 0) * 1000,
        })).filter((p: any) => p.text.length > 30);
        if (rows.length) return rows;
      }
      const l = await fetch(
        `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Comments&limit=50&sort=TopAll`
      );
      if (!l.ok) throw new Error(`reddit HTTP ${r.status}, lemmy HTTP ${l.status}`);
      const lj = await l.json();
      return (lj.comments ?? []).map((c: any) => ({
        platform: "lemmy",
        author: c.creator?.name ?? "unknown",
        text: strip(c.comment?.content ?? "").slice(0, 800),
        score: c.counts?.score ?? 0,
        url: c.comment?.ap_id,
        ts: Date.parse(c.comment?.published ?? "") || Date.now(),
      }));
    });
  },
});

export const fetchBluesky = internalAction({
  args: { sourceId: v.id("sources"), query: v.string() },
  handler: async (ctx, { sourceId, query }) => {
    await runFetch(ctx, sourceId, `bluesky: ${query}`, async () => {
      const r = await fetch(
        `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=100`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      return (json.posts ?? []).map((p: any) => ({
        platform: "bluesky",
        author: p.author?.handle ?? "unknown",
        text: (p.record?.text ?? "").slice(0, 800),
        score: (p.likeCount ?? 0) + (p.repostCount ?? 0),
        url: p.author?.handle && p.uri
          ? `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`
          : undefined,
        ts: Date.parse(p.record?.createdAt ?? "") || Date.now(),
      }));
    });
  },
});

export const fetchHN = internalAction({
  args: { sourceId: v.id("sources"), query: v.string() },
  handler: async (ctx, { sourceId, query }) => {
    await runFetch(ctx, sourceId, `hackernews: ${query}`, async () => {
      const r = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment&hitsPerPage=100`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      return json.hits.map((h: any) => ({
        platform: "hn",
        author: h.author ?? "unknown",
        text: strip(h.comment_text ?? "").slice(0, 800),
        score: h.points ?? 0,
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        ts: (h.created_at_i ?? 0) * 1000,
      }));
    });
  },
});

export const fetchMastodon = internalAction({
  args: { sourceId: v.id("sources"), query: v.string() },
  handler: async (ctx, { sourceId, query }) => {
    await runFetch(ctx, sourceId, `mastodon: #${query}`, async () => {
      const tag = query.replace(/\s+/g, "").toLowerCase();
      const r = await fetch(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      return json.map((t: any) => ({
        platform: "mastodon",
        author: t.account?.acct ?? "unknown",
        text: strip(t.content ?? "").slice(0, 800),
        score: (t.favourites_count ?? 0) + (t.reblogs_count ?? 0),
        url: t.url,
        ts: Date.parse(t.created_at ?? "") || Date.now(),
      }));
    });
  },
});

export const sources = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("sources").order("desc").take(20)),
});

export const recentPosts = query({
  args: { limit: v.number(), platform: v.optional(v.string()) },
  handler: async (ctx, { limit, platform }) =>
    (await ctx.db.query("posts").order("desc").take(platform ? 400 : Math.min(limit, 60)))
      .filter((p) => !platform || p.platform === platform)
      .slice(0, Math.min(limit, 60)).map((p) => ({
      platform: p.platform, author: p.author, text: p.text.slice(0, 180), score: p.score, url: p.url,
    })),
});

export const postCount = query({
  args: {},
  handler: async (ctx) => {
    // ponytail: full scan is fine at hackathon scale (<5k posts); Aggregate component if it grows
    const all = await ctx.db.query("posts").take(5000);
    return all.length;
  },
});

// Bulk endpoint for the Go scraper sidecar (scraper/): one source row per
// (platform, query) scrape, posts arrive pre-normalized and deduped.
export const insertScraped = mutation({
  args: {
    platform: v.string(),
    query: v.string(),
    posts: v.array(v.object({
      author: v.string(), text: v.string(), score: v.number(),
      url: v.optional(v.string()), ts: v.number(),
    })),
  },
  handler: async (ctx, { platform, query, posts }) => {
    if (posts.length > 500) throw new Error(`batch too large (${posts.length} > 500) — chunk client-side`);
    const sourceId = await ctx.db.insert("sources", { platform, query: query + " (go)", status: "running", count: 0 });
    const rows = posts.map((p) => ({ platform, ...p }));
    const { inserted, skipped } = await insertPostRows(ctx, sourceId, rows);
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L0", status: "done", progress: 1,
      detail: `${platform} (go scraper): +${inserted} posts (${skipped} dup/junk skipped)`,
    });
    return { inserted, skipped };
  },
});

// which LLM tiers are live (dashboard + settings page)
export const llmInfo = action({
  args: {},
  handler: async (ctx) => {
    const { getCfg, tiersOf } = await import("./llm");
    const cfg = await getCfg(ctx);
    return { tiers: tiersOf(cfg) };
  },
});
