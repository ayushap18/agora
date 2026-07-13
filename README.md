# AGORA — a Consequence Engine (showcase prototype)

> Every decision gets debated after it ships. Agora lets you watch the debate before.

Single-file prototype: `index.html`, zero dependencies, zero build.

```sh
python3 -m http.server 8642   # then open http://127.0.0.1:8642
```

## Demo script (3 min)
1. Pick a decision (or paste your own), optionally drop a CSV → **Materialize personas**.
2. **Run** (or press `space`). Rounds tick; personas argue across the social graph; the
   opinion-space map polarizes; the drift river moves; factions crystallize; the
   **Dissent Agent** flags the quietly-hurt cohort.
3. **⚡ Intervene** mid-run → pick an amendment → the timeline **forks**; both futures
   simulate side by side (divergence chart + fork tally).
4. Open a **second browser tab** at the same URL → it auto-joins as a live mirror
   (BroadcastChannel — the "reactive queries" moment).
5. Hard-reload mid-run → the setup screen offers **Resume** at the exact round
   (localStorage — the "durable workflow" moment).
6. **Verdict** → predicted approval, biggest risk, amendments ranked by projected
   opposition flipped. Scrub the timeline to replay any round.

## Convex wiring plan (the real backend)
The in-browser engine is a stand-in with the same state shape as the target schema
(`runs / personas / edges / stances / factions / events`):

| Prototype piece | Convex replacement |
|---|---|
| `Sim.tick()` loop | Workflow component (durable N-round run) |
| per-persona stance update | Workpool fan-out → Agent component threads + LLM action |
| quote/reason templates | LLM `llmStance()` action, RAG over uploaded corpus (vector search) |
| BroadcastChannel mirror | reactive `useQuery(api.sim.liveState)` — free, cross-device |
| localStorage resume | Workflow durability — free |
| `estimateFlips` clones | scheduler-spawned counterfactual runs |
| tally recompute | Aggregate / Sharded Counter |
