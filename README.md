# AGORA — a Consequence Engine

> Every decision gets debated after it ships. Agora lets you watch the debate before.

Paste a decision. Agora ingests **real posts from Reddit(-style), Hacker News, Bluesky,
Mastodon (+ X via import)**, distills them into stakeholder cohorts, grows a
**1,800-persona social graph**, and runs a **durable multi-round simulation** where
opinions spread by bounded-confidence influence. Factions emerge. A Dissent Agent names
who gets quietly hurt. Fork the timeline mid-run with an amendment and watch two futures
diverge — all streaming live to every open browser via Convex reactive queries.

## Run it

```sh
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev   # local backend, no account needed
npx vite --port 8642                          # in a second terminal
# open http://localhost:8642
```

Optional (real LLM voices — Gemini): `npx convex env set GEMINI_API_KEY <key>`.
Without a key every Gemini call falls back to deterministic content sourced from the
real corpus — nothing blocks.

**Deep corpus pull (Go sidecar):** `cd scraper && go run . -q "your query" -pages 4`
— scrapes HN/Bluesky/Mastodon/Lemmy concurrently with pagination, dedupes, and
bulk-inserts through Convex's HTTP API (~550 posts in ~5 s); the harness console
fills live while it runs. The simulation workflow itself stays inside Convex on
purpose: durability comes from Convex owning workflow state — an external runner
is exactly the process that dies.

**Model-accuracy harness:** `npx convex run selftest:run` — proves engine
invariants on demand (same-seed determinism, stance bounds, tally conservation,
roundStats integrity, drift sanity) and cleans up after itself.

**Corpus cache (Ruby):** `ruby cache/corpus_cache.rb pull|replay|list|stats|clean -q "…"`
— snapshots Go-scraper pulls to disk and replays them into Convex with zero network
(offline-demo insurance + instant refills). All ingest paths share one server-side
gate: content-hash dedupe + ≥5-word quality filter, so re-runs never store garbage.

**Local LLM:** `npx convex env set LOCAL_LLM_URL http://127.0.0.1:11434` (Ollama) and
optionally `LOCAL_LLM_MODEL llama3.2` — the voices/distill chain tries local → Gemini
→ deterministic fallback. The dashboard's LLM-tier tile shows which is live.

**Settings (⚙ on the dashboard):** BYOK Gemini key · local model (Ollama URL+name) ·
Hugging Face token+model (router.huggingface.co) · rounds (6–20) · tick speed ·
model council toggle. Keys stay in the local Convex DB.

**Model council:** at verdict time every configured model predicts the final
approval% blind from the round-0 cohort brief; the engine's outcome is ground
truth and each model gets an accuracy score (100 − |error|), plus a consensus.

**Reddit chain:** reddit.json → PullPush (free Pushshift successor, real Reddit
comments when up) → Lemmy — posts always labeled by their true origin.

**Workspace hygiene:** `npx convex run ops:cleanup` (or the dashboard's Clean
workspace button) — keeps the latest baseline per decision + its forks, cascade-deletes
everything else in batches, sweeps orphans/duplicates/failed sources.

## The harness — 7 layers, all observable live

| Layer | What | Convex surface |
|---|---|---|
| L0 INGEST | Reddit(→Lemmy fallback)/HN/Bluesky/Mastodon fetch + X import | actions, scheduler |
| L1 DISTILL | real posts → 6–8 cohorts (names, stances, seed quotes) | action + Gemini (fallback: keyword clustering) |
| L2 POPULATE | 1,800 personas, each grown from a real post (`seedRef`) | mutation, chunked tables (500/chunk) |
| L3 GRAPH | homophilous social graph, packed adjacency | mutation |
| L4 SIMULATE | 12 durable rounds of influence propagation | **Workflow component** — survives backend kills |
| L5 VOICES | sampled persona quotes + Dissent Agent + Synthesizer | **Workpool** (4-parallel) + **Rate Limiter** (8/min) |
| L6 SERVE | liveState/timeline/feed/factions/estimates | reactive queries — zero websocket code of ours |

The **Harness Console** (`②③` buttons) shows each layer light up as it runs; the
pipeline rail, corpus ticker, and cohort cards are all live subscriptions.

## Demo script

1. Landing → **Materialize personas** → Harness Console.
2. **Fetch** any sources (real requests, watch the ticker fill) → **② Distill** → **③ Build network**.
3. **Enter war room** → **Run**. 1,800 nodes polarize; factions crystallize; the Dissent
   Agent fires at rounds 3/7.
4. Copy the URL (it carries `#run=<id>`) into **another browser or device** — identical
   live state, no refresh. That's Convex reactivity.
5. **⚡ Intervene** mid-run → pick an amendment → timelines fork side by side.
6. `kill` the `convex dev` process mid-run, restart it — the workflow **resumes where it
   died** (verified: killed at round 3, completed to 12 untouched).
7. **Verdict** → predicted approval, biggest risk, and amendments ranked by
   counterfactual flips (4 silent scheduler runs of the same engine).
8. Click any node → persona popover with its stance history **and the real post it grew
   from**, linked to the source.

## Honesty notes

- X/Twitter's free API (~100 reads/mo) is unusable and scraping violates ToS — X ships
  as paste/CSV import. Reddit's public JSON blocks many networks; the adapter falls back
  to Lemmy and labels posts honestly.
- Stance movement is deterministic math (bounded confidence + conviction hardening),
  seeded and replayable. LLM calls voice the debate; they never move the numbers.

## Repo map

`convex/` — schema, ingest, distill, populate, engine, sim (workflow), voices, serve,
pipeline · `src/main.js` — vanilla UI (war room canvas/SVG renderers + Convex adapters)
· `index.html` — all views · `docs/superpowers/` — design spec + implementation plan.
