# AGORA on Convex — layered harness design

Date: 2026-07-13 · Status: approved direction ("plan it and build it")
Prototype being replaced: `index.html` in-browser engine (BroadcastChannel mirror,
localStorage resume, seeded Sim class). The UI (war room, charts, landing) is kept.

## Goal

Turn the AGORA prototype into a real Convex-backed consequence engine for the
hackathon: personas seeded from **real social-media posts**, a **1,500–2,000 node**
social graph, a **durable multi-round simulation**, live LLM voices via **Gemini**,
and everything streaming reactively to every open client. Timeline: 24–30h.

## Decisions taken (with user)

- **Timeline**: 24–30 hours.
- **LLM**: Gemini (Flash tier). Must degrade gracefully with no key.
- **UI**: keep the existing vanilla single-file war room; wire it via
  `ConvexClient` (vanilla browser client, `onUpdate` subscriptions). No React.
- **LLM depth**: hybrid — deterministic influence math moves stances; Gemini
  voices a sampled subset per round + Dissent Agent + synthesizer.
- **X/Twitter**: free API tier (~100 reads/mo) is unusable and scraping violates
  ToS. X ships as an **import adapter** (paste text / CSV export / optional
  user-supplied bearer token). Live sources: **Reddit, Hacker News, Mastodon**
  (free public JSON APIs, fetched server-side from Convex actions).

## Architecture — 7 layers

| Layer | Name | Runtime | Does |
|---|---|---|---|
| L0 | INGEST | actions | `fetchReddit(query)`, `fetchHN(query)`, `fetchMastodon(tag)`, `importX(text)` → `posts` rows (~300–800) |
| L1 | DISTILL | Workpool + Gemini | batch-tag posts → grievance tags; cluster into 6–9 cohorts with names, base stance, seed quotes. Fallback: keyword heuristics |
| L2 | POPULATE | mutation | synthesize N personas (default 1800) from cohort shares; each persona has seedRefs to real posts |
| L3 | GRAPH | mutation | homophilous social graph, 6–8 edges/node (~12–16k edges); influence ∝ source-post karma; packed adjacency chunks |
| L4 | SIMULATE | Workflow | one durable step per round × 12; bounded-confidence math tick over chunks; writes `stanceChunks`, factions, events |
| L5 | VOICES | Workpool + Rate Limiter + Agent | ~15 sampled personas/round get Gemini reasoning (persistent threads), + Dissent Agent + round synthesizer. Fallback: cohort seed quotes |
| L6 | SERVE | queries | `liveState(runId)`, `timeline`, `factions`, `feed`, `pipeline` — reactive; UI subscribes |

Each layer writes `pipeline` rows (`{runId?, layer, status, progress, detail}`);
a new **Harness Console** screen (between landing and war room) shows the layers
lighting up live. Layers are independently re-runnable; no layer hard-depends on
Gemini being up.

## Schema

```
decisions     { title, body, status }
sources       { platform, query, status, count, error? }
posts         { sourceId, platform, author, text, score, url?, ts, tags?[], cohortIdx? }
cohorts       { decisionId, name, share, baseStance, vol, infMult, tags[], seedQuotes{o,n,s}, facOpp, facSup, hurt? }
runs          { decisionId, parentRunId?, forkedAtRound?, label, status, round, config{n, rounds, seed, tickMs}, amendment? }
personaChunks { runId, chunkIdx, names[], cohortIdx[], inf[], stub[], seedRef[] }   // 500/chunk
adjChunks     { runId, chunkIdx, flatAdj[], offsets[] }
stanceChunks  { runId, round, chunkIdx, values[] }
voices        { runId, round, personaIdx, name, cohort, stance, text, kind }  // quote|dissent|synthesis
factions      { runId, round, list[{name,n,side,arg}] }
events        { runId, round, kind, payload }
pipeline      { runId?, layer, status, progress, detail, ts }
```

Scale rationale: packed chunks keep a 2,000-persona × 13-round run at ~60 docs
instead of 26k rows; the round tick is one internal mutation reading 8 docs and
writing 4. Convex per-transaction limits are never approached.

## Engine (L4)

Port of the prototype's tuned math (bounded confidence `1-|Δ|·.75`, social .30,
harden .045, cohort beats, sustained amendment fx/4). Deterministic via
mulberry32(seed) — same seed → same run. Workflow step per round; `tickMs` sleep
between rounds (demo pacing). Fork = `forkRun(runId, amendment)` copies stance
chunks at current round into a child run and starts its workflow. Verdict flip
estimates = scheduler-spawned silent 4-round counterfactual runs.

## Gemini (L1 + L5)

Plain `fetch` to `generativelanguage.googleapis.com` (Flash model), JSON output,
key from Convex env `GEMINI_API_KEY`. Rate Limiter component caps ~20 calls/round.
Voices sampled: highest-influence movers + faction representatives + 2 random.
Personas that speak keep an Agent-component thread so round-8 reasoning remembers
round-2. Every Gemini path has a deterministic fallback (keyword tagging, seed
quotes) so the demo cannot stall on quota.

## UI wiring (L6)

- Keep `index.html` visuals; extract JS into `src/app.js`; Vite dev server
  (replaces the python static server) bundles `convex/browser`.
- Landing → **Harness Console** (source pickers, live pipeline, cohort cards,
  post ticker) → **Materialize** → war room.
- War room panels subscribe via `client.onUpdate(api.serve.liveState, {runId})`;
  the scrubber reads `stanceChunks` by round (all rounds persist — replay free).
- Delete: BroadcastChannel mirror, localStorage resume, in-browser Sim ticking
  (Sim class stays only as the shape reference for rendering).

## Error handling

- Ingest: per-source status rows; a failed source shows as failed, never blocks others.
- Gemini: timeout 15s/call → fallback content; Rate Limiter prevents 429 storms.
- Workflow: Convex retries failed steps; the run resumes after backend restarts (stage demo: kill `convex dev` mid-run).
- UI: run selector recovers any live/completed run on page load.

## Milestones (each ends demoable)

M0 scaffold: Vite + `npx convex dev` (anonymous local), components installed, hello schema deployed.
M1 L0 + pipeline table + Harness Console skeleton (real Reddit/HN/Mastodon fetches visible live).
M2 L1–L3: cohorts from posts, 1,800 personas, graph chunks.
M3 L4 + war room reading Convex (map/river/tally/scrub live from a second browser).
M4 forks + L5 voices + dissent + factions feed.
M5 verdict + counterfactual flips + polish + kill/resume rehearsal.

Cut lines if late: Agent threads → stateless action calls; Mastodon → drop;
vector-search grounding (stretch) → tag matching; Harness Console animations → plain rows.

## Success criteria

1. Two devices show the same run ticking with no refresh and no socket code in ours.
2. `convex dev` killed mid-run resumes the workflow where it stopped.
3. A fork mid-run produces visibly divergent futures side by side.
4. Personas quote/derive from real fetched posts (provenance chip links the source).
5. A full 2,000-node, 12-round run completes in under 4 minutes with zero Gemini quota errors.
