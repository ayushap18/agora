# Execution plan: fixes + settings + model council (branch: building)

Order of execution — each step tested before the next:

**P0 — Fix verdict + intervene.** Hypothesis: `sim.estimate` clones 4 silent runs
in one mutation (full chunk-history copy each) → exceeds the 16 MB/txn read limit
at ≥1000 personas → estimates never appear; fork of big runs risks the same.
Fix: silent forks copy ONLY the current round's stances (they simulate forward,
never scrub); each estimate fork spawns in its own scheduled transaction.

**P1 — Settings page + runtime config.** New `settings` table (single row) editable
from a ⚙ Settings view: BYOK Gemini key · local model URL+name (Ollama) ·
Hugging Face token+model (router.huggingface.co, OpenAI-compatible) · rounds
(6–20) · tick ms · council on/off. `llm.ts` reads settings-first, env-fallback.
Keys live in the local Convex DB — fine for a local demo, stated plainly in the UI.

**P2 — Model council.** At verdict time each configured model (local · gemini · HF)
independently predicts final approval% from the round-0 cohort brief; the engine's
simulated result is ground truth. Council card shows per-model prediction, error,
and an accuracy% (100 − |pred − actual|), plus consensus. Runs through the existing
rate limiter; absent models are skipped.

**P3 — Real Reddit via PullPush.** Free, no-auth Pushshift successor
(api.pullpush.io/reddit/search/comment/?q=…). Adapter chain becomes
reddit.json → PullPush → Lemmy, in both Convex ingest and the Go scraper.

**P4 — Opinion space de-clustering.** Cohort bands sized by cohort share (dense
cohorts get more vertical room), stance-correlated in-band spread, node radius
scaled by 1/√(n/800), stronger jitter — kills the band-center clumping.

**P5 — Live source tabs.** Corpus ticker gets a tab bar (all · per-platform):
tab-switch shows what each source is doing (its posts + status) live.

**P6 — Full E2E** on a fresh custom query, fix anything found, push.
