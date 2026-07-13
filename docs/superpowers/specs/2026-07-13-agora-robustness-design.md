# AGORA data-layer + interactive map design (branch: building)

## Requirements

**Functional:** every chart/tally reads from properly stored per-round data (no on-the-fly
recomputation of history); Opinion Space becomes interactive (zoom, pan, hover-highlight
with neighbor edges, click drill-down) and smooth at 1,800 nodes; estimate runs are
unambiguous and garbage-collected.

**Non-functional:** liveState push per round ≤ ~15 KB (stances only — no static meta);
map ≥ 50 fps during a run on a laptop; timeline query O(rounds) indexed reads, O(1) per
new round; zero recompute storms when many clients subscribe.

**Constraints:** hackathon codebase, vanilla JS UI, Convex local dev, no new deps.

## Current defects being fixed

1. **Double draw:** legacy rAF loop still draws the map every frame alongside the new
   loop → 2× canvas work at 1,800 nodes → the "stiff" feel. Fix: legacy loop defused
   (`S.sim` no longer aliased), single new loop owns the canvas.
2. **Fat reactive payload:** `liveState` re-ships `cohortIdx[1800]` + `inf[1800]`
   (static) with every round. Fix: split into one-time `personaMeta` (names, cohortIdx,
   inf, adjacency) + slim per-round `liveState` (stances + tally + factions).
3. **O(rounds²) timeline:** `timeline` re-reads every round's chunks on every update,
   per subscriber. Fix: `roundStats` table written once by the engine at tick time
   (single source of tally truth — same 0.12 thresholds as the UI); `timeline` becomes
   an indexed read. Old runs without stats fall back to compute.
4. **Estimate ambiguity + garbage:** counterfactual batches were grouped by a 60 s
   window and never cleaned. Fix: `sim.estimate` deletes the previous silent children
   (runs + chunks + stats) before spawning a new batch — the silent set is always
   exactly one batch.
5. **Edge rendering per frame:** 5.7 k edge strokes every frame. Fix: edges render to an
   offscreen layer only when the round advances (or view changes size), blitted under
   the current zoom/pan transform each frame; only the hovered node's edges draw live.

## Data model delta

```
roundStats { runId, round, sup, opp, neu, n }   index by_run (runId, round)
```
Written by `engine.tickRound` (and `populate.run` for round 0), read by
`serve.timeline`, `serve.estimates`. Everything else unchanged.

## Query contracts (after)

- `serve.personaMeta {runId}` → `{names[], cohortIdx[], inf[], adj: [{flatAdj,offsets}]}` — fetched once per run per client (~60 KB), replaces `serve.graph`.
- `serve.liveState {runId}` → `{run, stances[], tally, factions, cohorts}` — the only hot subscription.
- `serve.timeline {runId}` → `roundStats` rows ascending (fallback: compute).
- `serve.estimates {runId}` → all current silent children vs `__control__` (no time-window).

## Interactive map (client)

View state per canvas: `{zoom, panX, panY, hover, drag}` — world coords are the
existing stance-x/cohort-y layout; screen = world × zoom + pan.
- **wheel** zooms to cursor (clamp 0.6–4×), **drag** pans, **dblclick** resets.
- **hover** (inverse-transform hit test, 14 px) highlights the node, draws its edges
  live, shows an HTML name/cohort chip; click opens the existing provenance popover.
- Node motion: lerp 0.12 (was 0.07) + reduced wobble — responsive, not floaty.
- Edge layer: offscreen canvas redrawn on round advance / resize, blitted per frame.

## Trade-offs

- Offscreen edges are anchored to per-round target positions, not per-frame animated
  positions — at 0.03–0.06 alpha the ≤4 px mismatch is invisible; buys back the frame budget.
- Blitting the edge layer under zoom scales raster (slight blur > 2×) instead of
  re-stroking 5.7 k paths during interaction — right side of the cost curve.
- `roundStats` duplicates what stanceChunks imply; ~13 tiny rows per run is the cheapest
  cache in the system and kills the biggest read amplifier.

## Revisit as it grows

>5 k personas: move tick to an action with typed arrays + write-back; virtualize edge
layer by viewport. >50 concurrent viewers: move `feed` merge into a table written at
insert time. Cloud deploy: swap anonymous local for `npx convex deploy`, same code.
