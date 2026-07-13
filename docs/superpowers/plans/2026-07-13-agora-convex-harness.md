# AGORA Convex Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-browser AGORA simulation with a real Convex backend: 7-layer harness ingesting Reddit/HN/Mastodon (+X import), Gemini-distilled cohorts, an 1,800-persona graph, a durable Workflow simulation, Workpool voices, reactive queries into the existing vanilla war-room UI.

**Architecture:** Layers L0–L6 per the spec (`docs/superpowers/specs/2026-07-13-agora-convex-harness-design.md`). State is chunked (500 personas/chunk). Deterministic math moves stances; Gemini only voices. Every layer writes `pipeline` progress rows and degrades without a Gemini key.

**Tech Stack:** Convex (local anonymous dev deployment) + components `@convex-dev/workflow`, `@convex-dev/workpool`, `@convex-dev/rate-limiter`; Vite (vanilla, no React); Gemini REST (`gemini-2.0-flash`) via `fetch` — no AI SDK dependency.

## Global Constraints

- Node ≥ 18 (have v22.19.0). No React. No new UI frameworks.
- Persona count default **1800**, chunk size **500**, rounds **12**.
- Engine math copied verbatim from prototype: social `.30`, harden `.045`, bounded confidence `max(.08, 1-|Δ|*.75)`, amendment `fx/4` sustained.
- Every Gemini call: 15s timeout, deterministic fallback, guarded by Rate Limiter (8/min).
- X ingestion is import-only (paste text/CSV). No scraping.
- All work in `/Users/ayush18/hackbriven`. Commit after every task.
- Convex dev must run with `CONVEX_AGENT_MODE=anonymous` (no account needed); if that fails, stop and ask user to `npx convex login`.

---

### Task 1: Scaffold — Vite + Convex anonymous deployment + components

**Files:**
- Create: `package.json`, `convex/convex.config.ts`, `convex/schema.ts`, `src/main.js` (empty entry), `.gitignore`
- Modify: `index.html` (add `<script type="module" src="/src/main.js">` — existing inline script stays for now)

**Interfaces:**
- Produces: running local Convex deployment (`.env.local` → `VITE_CONVEX_URL`), deployed schema, components registered as `components.workflow`, `components.voicesPool`, `components.rateLimiter`.

- [ ] **Step 1: Init package + deps**

```bash
cd /Users/ayush18/hackbriven
npm init -y
npm i convex @convex-dev/workflow @convex-dev/workpool @convex-dev/rate-limiter
npm i -D vite
printf 'node_modules\n.env.local\ndist\n' > .gitignore
```

- [ ] **Step 2: convex/convex.config.ts**

```ts
import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(workflow);
app.use(workpool, { name: "voicesPool" });
app.use(rateLimiter);
export default app;
```

- [ ] **Step 3: convex/schema.ts** (full schema from spec)

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  decisions: defineTable({
    title: v.string(), body: v.string(), status: v.string(),
  }),
  sources: defineTable({
    platform: v.string(), query: v.string(), status: v.string(),
    count: v.number(), error: v.optional(v.string()),
  }),
  posts: defineTable({
    sourceId: v.id("sources"), platform: v.string(), author: v.string(),
    text: v.string(), score: v.number(), url: v.optional(v.string()),
    ts: v.number(), tags: v.optional(v.array(v.string())),
    cohortIdx: v.optional(v.number()),
  }).index("by_source", ["sourceId"]),
  cohorts: defineTable({
    decisionId: v.id("decisions"), idx: v.number(), name: v.string(),
    share: v.number(), baseStance: v.number(), vol: v.number(),
    infMult: v.number(), tags: v.array(v.string()),
    seedQuotes: v.object({ o: v.array(v.string()), n: v.array(v.string()), s: v.array(v.string()) }),
    facOpp: v.string(), facSup: v.string(), hurt: v.optional(v.string()),
    postIds: v.array(v.id("posts")),
  }).index("by_decision", ["decisionId"]),
  runs: defineTable({
    decisionId: v.id("decisions"), parentRunId: v.optional(v.id("runs")),
    forkedAtRound: v.optional(v.number()), label: v.string(),
    status: v.string(), // materializing|ready|running|complete|failed
    round: v.number(),
    config: v.object({ n: v.number(), rounds: v.number(), seed: v.number(), tickMs: v.number() }),
    amendment: v.optional(v.object({ label: v.string(), fx: v.record(v.string(), v.number()) })),
    silent: v.optional(v.boolean()), // counterfactual estimate runs
  }).index("by_decision", ["decisionId"]),
  personaChunks: defineTable({
    runId: v.id("runs"), chunkIdx: v.number(),
    names: v.array(v.string()), cohortIdx: v.array(v.number()),
    inf: v.array(v.number()), stub: v.array(v.number()),
    seedRef: v.array(v.union(v.id("posts"), v.null())),
  }).index("by_run", ["runId", "chunkIdx"]),
  adjChunks: defineTable({
    runId: v.id("runs"), chunkIdx: v.number(),
    flatAdj: v.array(v.number()), offsets: v.array(v.number()),
  }).index("by_run", ["runId", "chunkIdx"]),
  stanceChunks: defineTable({
    runId: v.id("runs"), round: v.number(), chunkIdx: v.number(),
    values: v.array(v.number()),
  }).index("by_run_round", ["runId", "round", "chunkIdx"]),
  voices: defineTable({
    runId: v.id("runs"), round: v.number(), personaIdx: v.number(),
    name: v.string(), cohort: v.string(), stance: v.number(),
    text: v.string(), kind: v.string(), // quote|dissent|synthesis
  }).index("by_run", ["runId", "round"]),
  factions: defineTable({
    runId: v.id("runs"), round: v.number(),
    list: v.array(v.object({ name: v.string(), n: v.number(), side: v.string(), arg: v.string() })),
  }).index("by_run", ["runId", "round"]),
  events: defineTable({
    runId: v.id("runs"), round: v.number(), kind: v.string(), payload: v.any(),
  }).index("by_run", ["runId"]),
  pipeline: defineTable({
    runId: v.optional(v.id("runs")), layer: v.string(), status: v.string(),
    progress: v.number(), detail: v.string(), ts: v.number(),
  }).index("by_layer", ["layer"]),
});
```

- [ ] **Step 4: Start anonymous local deployment + codegen**

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```
Expected: downloads local backend, creates deployment, writes `.env.local` with `VITE_CONVEX_URL=http://127.0.0.1:32xx`, pushes schema + components with no errors. If it errors on anonymous mode: STOP, ask user to run `npx convex login`.

- [ ] **Step 5: Keep dev processes running in background**

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev   # background — watches convex/
npx vite --port 8642                          # background — serves index.html
```
Expected: `curl -s localhost:8642 | head -1` returns `<!DOCTYPE html>`; page renders unchanged.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "scaffold: convex + vite + schema + components"`

---

### Task 2: L0 INGEST — sources, posts, pipeline helpers

**Files:**
- Create: `convex/ingest.ts`, `convex/pipeline.ts`

**Interfaces:**
- Produces:
  - `pipeline.log` internalMutation `{layer, status, progress, detail, runId?}` — upserts by layer (latest row wins; keep history capped at 200).
  - `api.ingest.start` mutation `{platform: "reddit"|"hn"|"mastodon", query: string} → sourceId`, schedules the matching internal action.
  - `api.ingest.importX` mutation `{text: string} → {count}` — splits pasted lines/CSV into posts (`platform:"x"`).
  - internal actions `fetchReddit/fetchHN/fetchMastodon {sourceId, query}` — fetch, normalize, `insertPosts`, update source status.
  - `api.ingest.sources` query → all sources newest-first. `api.ingest.recentPosts` query `{limit}` → newest posts.

- [ ] **Step 1: convex/pipeline.ts**

```ts
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const log = internalMutation({
  args: { layer: v.string(), status: v.string(), progress: v.number(),
          detail: v.string(), runId: v.optional(v.id("runs")) },
  handler: async (ctx, a) => {
    await ctx.db.insert("pipeline", { ...a, ts: Date.now() });
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("pipeline").order("desc").take(60);
    const byLayer: Record<string, typeof rows[0]> = {};
    for (const r of rows) if (!byLayer[r.layer]) byLayer[r.layer] = r;
    return Object.values(byLayer).sort((a, b) => a.layer.localeCompare(b.layer));
  },
});
```

- [ ] **Step 2: convex/ingest.ts** — normalizers per platform:

```ts
// Reddit: GET https://www.reddit.com/search.json?q=<q>&limit=100&sort=relevance
//   headers: { "User-Agent": "agora-research/0.1" }
//   items: json.data.children[].data → {author, text: title+selftext, score, url: permalink, ts: created_utc*1000}
// HN:     GET https://hn.algolia.com/api/v1/search?query=<q>&tags=comment&hitsPerPage=100
//   items: json.hits[] → {author, text: comment_text stripped of HTML, score: points??0, url: story link, ts}
// Mastodon: GET https://mastodon.social/api/v1/timelines/tag/<q>?limit=40
//   items: [] → {author: acct, text: content stripped of HTML, score: favourites_count, url, ts}
```
Action shape (same for all three):
```ts
export const fetchReddit = internalAction({
  args: { sourceId: v.id("sources"), query: v.string() },
  handler: async (ctx, { sourceId, query }) => {
    await ctx.runMutation(internal.pipeline.log, { layer: "L0", status: "running", progress: 0, detail: `reddit: ${query}` });
    try {
      const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=100&sort=relevance`,
        { headers: { "User-Agent": "agora-research/0.1" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      const posts = json.data.children.map((c: any) => ({
        platform: "reddit", author: c.data.author ?? "unknown",
        text: (c.data.title + " " + (c.data.selftext ?? "")).slice(0, 800).trim(),
        score: c.data.score ?? 0, url: "https://reddit.com" + c.data.permalink,
        ts: (c.data.created_utc ?? 0) * 1000,
      })).filter((p: any) => p.text.length > 30);
      await ctx.runMutation(internal.ingest.insertPosts, { sourceId, posts });
    } catch (e: any) {
      await ctx.runMutation(internal.ingest.markSource, { sourceId, status: "failed", error: String(e.message) });
    }
  },
});
```
`insertPosts` inserts rows, sets source `{status:"done", count}`, logs `L0 done`.

- [ ] **Step 3: Verify with real fetches**

```bash
npx convex run ingest:start '{"platform":"reddit","query":"return to office mandate"}'
sleep 6
npx convex run ingest:sources | head -5
```
Expected: source row `status:"done", count > 20`. Repeat for `hn` and `mastodon` (mastodon may return fewer; >0 or clean `failed` both acceptable).

- [ ] **Step 4: Commit** — `git commit -am "feat(L0): ingest reddit/hn/mastodon + x import + pipeline log"`

---

### Task 3: Harness Console UI + client wiring foundation

**Files:**
- Create: `src/convexClient.js`
- Modify: `index.html` — new `#harness` view between `#setup` and `#room`; move the inline `<script>` body into `src/main.js` unchanged, then add harness rendering.

**Interfaces:**
- Consumes: `api.pipeline.latest`, `api.ingest.{start,importX,sources,recentPosts}`.
- Produces: `src/convexClient.js` exporting `client` (ConvexClient) and `api`; `showView(id)` helper; harness screen with: source query inputs + fetch buttons per platform, X paste box, live source status chips, scrolling post ticker, layer rail L0–L6 (lit from pipeline rows), and a **Build network →** button (wired in Task 5).

- [ ] **Step 1: src/convexClient.js**

```js
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
export const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
export { api };
```

- [ ] **Step 2:** Move inline script → `src/main.js`; `index.html` keeps only `<script type="module" src="/src/main.js"></script>`. Verify prototype still fully works (it still uses the local Sim for now).

- [ ] **Step 3:** Add `#harness` view markup (cards styled with existing `.card`, `.pill`, `.faction` classes) + subscriptions:

```js
client.onUpdate(api.pipeline.latest, {}, renderPipelineRail);
client.onUpdate(api.ingest.sources, {}, renderSources);
client.onUpdate(api.ingest.recentPosts, { limit: 30 }, renderPostTicker);
```
Landing "Materialize personas →" now routes to `#harness` (war room comes after Task 6).

- [ ] **Step 4: Verify in browser** — click fetch Reddit/HN buttons; sources chips flip pending→done and ticker fills with real posts, live, no refresh. Open a second tab: identical.

- [ ] **Step 5: Commit** — `git commit -am "feat(UI): harness console with live pipeline + ingest"`

---

### Task 4: L1 DISTILL — Gemini helper + cohort builder (with fallback)

**Files:**
- Create: `convex/gemini.ts`, `convex/distill.ts`

**Interfaces:**
- Produces:
  - `geminiJson(prompt: string): Promise<any|null>` — REST call to `gemini-2.0-flash`, `responseMimeType: application/json`, 15s AbortController timeout, returns `null` on any failure or missing `process.env.GEMINI_API_KEY`.
  - `api.distill.run` action `{decisionId} → {cohortCount}`: reads up to 400 posts, produces 6–9 `cohorts` rows.
  - Gemini path: batches of 40 post snippets → prompt asks for `{cohorts:[{name, share, baseStance, tags[3], seedQuotes{o[3],n[2],s[2]}, facOpp, facSup, hurt?}]}` grounded in the posts; assigns each post a cohortIdx.
  - Fallback path (no key / null): keyword-bucket posts by sentiment lexicon + platform, emit fixed-shape cohorts using the prototype's RTO cohort template with quotes sampled from actual post texts (truncated to 140 chars).
- Consumes: `posts` from Task 2.

- [ ] **Step 1:** `convex/gemini.ts` with `geminiJson` + `export const hasKey = () => !!process.env.GEMINI_API_KEY;`
- [ ] **Step 2:** `convex/distill.ts` — both paths; every batch logs `pipeline L1 progress`.
- [ ] **Step 3: Verify fallback first (no key set)**

```bash
npx convex run distill:run '{"decisionId":"<id from seeding a decision>"}'
npx convex run distill:listCohorts '{"decisionId":"<id>"}'
```
Expected: 6–9 cohorts, shares sum ≈ 1.0, every cohort has ≥3 seed quotes sourced from real post text.

- [ ] **Step 4:** If user provided key: `npx convex env set GEMINI_API_KEY <key>`, re-run, verify richer names/quotes.
- [ ] **Step 5: Commit** — `git commit -am "feat(L1): gemini distill + keyword fallback -> cohorts"`

---### Task 5: L2+L3 POPULATE — 1,800 personas + graph chunks

**Files:**
- Create: `convex/populate.ts`

**Interfaces:**
- Produces: `api.populate.run` mutation `{decisionId, n?: number, seed?: number} → runId`:
  creates `runs` row (`status:"ready"`, config `{n:1800, rounds:12, seed, tickMs:1500}`),
  4 `personaChunks`, 4 `adjChunks`, and `stanceChunks` round 0.
  Deterministic mulberry32(seed) — port the prototype's persona/graph builder verbatim,
  names from FIRST/LAST arrays, stance `clamp(base + (rng()-.5)*.55)`, influence pareto
  `(rng()<.08?1.6:0.4)+rng()*.6*infMult`, 68% intra-cohort edges, 2–5+3(influencer) degree.
  Adjacency packed flat: `offsets[i]..offsets[i+1]` slice of `flatAdj` = neighbors of persona i (global indices).
- Consumes: `cohorts` (Task 4). Personas get `seedRef` = random postId from their cohort's `postIds` (or null).

- [ ] **Step 1:** Implement; single mutation is fine (4 chunks × arrays of 500 ≈ well under limits). Log `pipeline L2/L3 done` with counts.
- [ ] **Step 2: Verify**

```bash
npx convex run populate:run '{"decisionId":"<id>"}'
npx convex run serve:debugCounts '{"runId":"<returned id>"}'
```
Expected: `{personas: 1800, chunks: 4, edges: ~10000-16000, round0: 4}` (add `serve.debugCounts` as an internal helper query in this task).

- [ ] **Step 3: Commit** — `git commit -am "feat(L2+L3): chunked personas + social graph"`

---

### Task 6: L4 SIMULATE — engine tick + durable workflow + fork

**Files:**
- Create: `convex/engine.ts`, `convex/sim.ts`

**Interfaces:**
- Produces:
  - `internal.engine.tickRound` internalMutation `{runId} → {round, done}` — reads all persona/adj chunks + previous round stanceChunks, runs the prototype math (Global Constraints values, incl. cohort beats table stored on the decision and `amendment.fx/4` if set), writes new stanceChunks + factions row (stance-bucket × dominant cohort, same thresholds as prototype: |s|>.45, ≥max(20, n*.011) members) + updates `runs.round`.
  - `internal.sim.simulation` workflow: loop rounds 1..12 → `step.runMutation(internal.engine.tickRound)` → `step.runMutation(internal.voices.schedule, ..., { runAfter: tickMs })` (voices no-ops until Task 8).
  - `api.sim.start` mutation `{runId}` — flips status `running`, `workflow.start(...)`.
  - `api.sim.fork` mutation `{runId, amendment: {label, fx}} → forkRunId` — clone run row (`parentRunId`, `forkedAtRound: round`), copy persona/adj chunks + stanceChunks rounds 0..current, set amendment, start its workflow.
- Consumes: chunk tables from Task 5.

- [ ] **Step 1:** `engine.ts` math — port `Sim.tick()` operating on flat arrays across chunks (assemble `prev: number[]` of length n from 4 chunk docs; write back in 4 slices).
- [ ] **Step 2:** `sim.ts` workflow:

```ts
export const workflow = new WorkflowManager(components.workflow);
export const simulation = workflow.define({
  args: { runId: v.id("runs") },
  handler: async (step, { runId }): Promise<void> => {
    for (let r = 1; r <= 12; r++) {
      const res = await step.runMutation(internal.engine.tickRound, { runId }, { runAfter: 1500 });
      await step.runMutation(internal.voices.schedule, { runId, round: r });
      if (res.done) break;
    }
    await step.runMutation(internal.sim.markComplete, { runId });
  },
});
```

- [ ] **Step 3: Verify full run**

```bash
npx convex run sim:start '{"runId":"<id>"}'
sleep 30 && npx convex run serve:runStatus '{"runId":"<id>"}'
```
Expected: `{status:"complete", round:12}`, 13×4 stanceChunks, ≥1 factions row by round 4.

- [ ] **Step 4: Durability check** — start a fresh run, `kill` the `convex dev` process at ~round 4, restart it, wait: run completes without intervention. This is demo moment #2; must pass.
- [ ] **Step 5: Fork check** — `npx convex run sim:fork '{"runId":"<running id>","amendment":{"label":"grandfather remote","fx":{"<cohort name>":0.95}}}'` mid-run → child run completes with final approval > parent's.
- [ ] **Step 6: Commit** — `git commit -am "feat(L4): durable workflow simulation + fork"`

---

### Task 7: L6 SERVE + war room on Convex

**Files:**
- Create: `convex/serve.ts`
- Modify: `src/main.js` — war room reads Convex; delete BroadcastChannel, localStorage persist/resume, and local tick loop.

**Interfaces:**
- Produces queries:
  - `api.serve.liveState {runId}` → `{run, stances: number[] (current round, concatenated), factions, cohorts: [{name, idx}], personaMeta: {namesSample, cohortIdx: number[], inf: number[]}}` — one subscription drives map+tally.
  - `api.serve.timeline {runId}` → per-round `{round, sup, neu, opp}` tallies (computed server-side from stanceChunks).
  - `api.serve.roundStances {runId, round}` → concatenated values (scrubber).
  - `api.serve.feed {runId}` → last 40 of voices+events merged, newest first.
  - `api.serve.runsForDecision {decisionId}` → runs (for fork side-by-side + run picker).
- Consumes: everything prior.

- [ ] **Step 1:** Implement queries (tally computed in the query, cheap: 4 docs).
- [ ] **Step 2:** Rewire `src/main.js`: `client.onUpdate(api.serve.liveState, {runId}, s => { S.remote = s; renderAll(); })`; map renderer takes `(stances, cohortIdx, inf)` arrays — the existing draw code already consumes flat arrays, keep node y-position derivation (cohort band + seeded jitter, same seed from run.config).
- [ ] **Step 3:** Fork UI = second `liveState` subscription on child run; divergence chart from two `timeline` subscriptions.
- [ ] **Step 4: Verify** — two browser windows, run ticking in both with no refresh; scrubber replays; fork shows side-by-side divergence. The three demo moments all real now.
- [ ] **Step 5: Commit** — `git commit -am "feat(L6): reactive war room on convex, prototype engine deleted"`

---

### Task 8: L5 VOICES — Workpool + Rate Limiter + dissent + synthesis

**Files:**
- Create: `convex/voices.ts`

**Interfaces:**
- Produces:
  - `internal.voices.schedule` internalMutation `{runId, round}` — picks ~15 speakers (top-3 |Δstance| movers, top faction rep each, 2 random, dissent target), `pool.enqueueAction(internal.voices.speak, ...)` each + one dissent + one synthesis when round ∈ {3,7,12}.
  - `internal.voices.speak` action — Rate-Limiter-gated `geminiJson` with persona context (name, cohort, seedRef post text, last 2 own voices, 3 neighbor stances) → `{text, stanceHint}`; fallback: cohort seedQuotes bucket by stance. Inserts `voices` row.
  - Workpool: `new Workpool(components.voicesPool, { maxParallelism: 4 })`.
  - RateLimiter: `{ gemini: { kind: "token bucket", rate: 8, period: MINUTE } }` — on deny, skip straight to fallback (never wait during a live round).
- Consumes: `voices.schedule` stub already called by the Task 6 workflow (replace stub).

- [ ] **Step 1:** Implement; dissent = lowest (cohort influence share) with mean < −.3 → template with cohort `hurt` text, or Gemini elaboration when key present.
- [ ] **Step 2: Verify without key** — run completes, feed shows seed-quote voices with provenance (persona name + cohort + linked source post). **With key** — quotes are novel, reference real post content, no 429s (`npx convex logs | grep -c 429` → 0).
- [ ] **Step 3: Commit** — `git commit -am "feat(L5): workpool voices + rate-limited gemini + dissent"`

---

### Task 9: Verdict + counterfactual flip estimates

**Files:**
- Modify: `convex/sim.ts` (add `api.sim.estimate`), `src/main.js` (verdict modal reads Convex)

**Interfaces:**
- Produces: `api.sim.estimate` mutation `{runId}` — for each of the decision's 3 draft amendments spawns a **silent** clone run (`silent:true`, 4 rounds from current stances, no voices), scheduler-driven; `api.serve.estimates {runId}` query returns `[{label, flips}]` when all silent runs complete (flips = parent.opp − clone.opp at +4 rounds).
- Amendment presets: carry the prototype's per-decision amendment lists into the `decisions` seeding (Task 4 seeds the decision; move amendment presets there).

- [ ] **Step 1:** Implement silent runs (reuse fork machinery with `rounds: current+4`, `silent` skips voices + factions).
- [ ] **Step 2: Verify** — verdict modal shows ranked flips > 0 for at least one amendment on the RTO decision; intervene modal shows the same numbers.
- [ ] **Step 3: Commit** — `git commit -am "feat: verdict with scheduler counterfactual flips"`

---

### Task 10: E2E rehearsal + README + cleanup

- [ ] **Step 1:** Full pass: landing → harness (fetch reddit+hn real queries) → distill → populate 1800 → run → fork mid-run → verdict; second window mirrors throughout; kill/restart `convex dev` mid-run once.
- [ ] **Step 2:** Check `npx convex logs` for errors; fix anything non-clean.
- [ ] **Step 3:** Rewrite README: run instructions (`npx convex dev` + `vite`), architecture layer map (real now, not "wiring plan"), demo script updated for harness console, X-import honesty note, `GEMINI_API_KEY` setup.
- [ ] **Step 4:** Delete dead prototype code from `src/main.js` (Sim class remnants beyond render helpers), `.claude/launch.json` → vite command.
- [ ] **Step 5:** Commit + push — `git commit -am "docs+cleanup: e2e verified" && git push`

## Self-review notes

- Spec coverage: L0→L6 = Tasks 2–8; pipeline console = 3; forks/durability = 6–7; verdict = 9; scale/chunking = 5; fallbacks = 4/8; success criteria exercised in 10. Vector-search grounding was spec'd as a stretch → deliberately absent here (cut line documented in spec).
- Types consistent: chunk tables defined once (Task 1), consumed by name in 5–7; `voices.schedule` stub declared in 6, filled in 8.
- No placeholders: fallback behaviors, thresholds, and API shapes are stated concretely; prototype math referenced by exact constant values in Global Constraints.
