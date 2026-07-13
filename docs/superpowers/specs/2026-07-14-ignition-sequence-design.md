# AGORA · Ignition Sequence — animation & assembly-bay design

The journey is an engine start. Every page transition is a stage of ignition;
the harness becomes the assembly bay (technical drawing); the war room is the
race. One metaphor spine, four stages, all ≤900ms, all skippable.

## Metaphor map
| Surface | Ferrari frame | Role |
|---|---|---|
| Landing hero | Showroom cinema | choose to drive |
| Garage band | The garage | pick the decision (the car) |
| Harness | **Assembly bay — exploded engineering drawing** | build the machine |
| War room | The race, pit-wall telemetry | watch it run |
| Verdict | Stewards' report / podium | the result |

## Animation system (one module: `ignition.js`)
- A single fixed overlay element + CSS keyframes; JS only orchestrates timings.
- `sequence(stages, onDone)` — stages are named CSS classes with durations.
- **Latency masking, never latency adding**: the real pipeline mutation fires
  the moment the button is pressed; the overlay holds min 600ms, releases the
  instant the first live event arrives (or its own max duration, whichever
  comes first).
- Click anywhere = skip. `prefers-reduced-motion` = instant cuts, zero motion.
- No assets, no libraries — CSS gradients + a few inline SVG dimension lines.

## Stage 0 — IGNITION (landing → garage) · ~700ms
Press START THE ENGINE →
1. Button flashes Rosso-active (#b01e0a), 80ms.
2. Tachometer slams a full L→R red sweep (280ms) with 2px low-frequency
   shudder on the hero headline (engine catch).
3. Page glides to the garage band. Tach label: IGNITION READY → RUNNING.

## Stage 1 — CRANK (garage → harness) · ~900ms, the signature moment
Press MATERIALIZE PERSONAS →
1. **CRANK (400ms)**: full-screen #181818 overlay; centered AGORA mark over a
   horizontal RPM bar of 48 ticks lighting L→R; caption-uppercase line cycles:
   `FUEL · REAL SOCIAL POSTS` → `SPARK · COHORTS` → `TORQUE · 1,800 PERSONAS`.
2. **FIRE (300ms)**: bar flashes full Rosso; 60ms white flash at 8% opacity;
   1px frame shake.
3. **REVEAL (200ms)**: overlay splits and slides up like a garage door,
   revealing the assembly bay already live.

## Stage 2 — THE ASSEMBLY BAY (harness as engineering drawing)
Blueprint language, zero photos:
- **Blueprint grid** background: 8px hairline grid at 3% ink + corner
  registration marks + dimension lines (CSS repeating-gradient + SVG).
- **Pipeline rail → vertical engine schematic.** Each layer is a component
  plate with a part number:
  `AG-L0 INTAKE` (sources) · `AG-L1 INJECTION` (distill) · `AG-L1.5 MIXTURE`
  (embeddings) · `AG-L2 BLOCK` (personas) · `AG-L3 DRIVETRAIN` (graph) ·
  `AG-L4 COMBUSTION` (simulation) · `AG-L5 EXHAUST NOTE` (voices) ·
  `AG-L6 TELEMETRY` (serve).
  A vertical **fuel line** connects the plates and fills Rosso as layers
  complete; the active plate pulses a Rosso hairline.
- **Source rows = spec sheet**: tabular figures, dimension-line separators,
  stamped status badges (DONE ink-stamp, FAILED warning-stamp).
- **Corpus ticker = parts feed**: each post prefixed by its platform part-code.
- **Steps as torque sequence**: ① FUEL (fetch) ② SPARK (distill) ③ TORQUE
  (build grid) — number-display numerals; locked steps render as ghost plates
  labeled AWAITING TORQUE.
- Micro-motion: fetch bars torque-fill with overshoot ease; cohort chips bolt
  in staggered 40ms; completed plates get a stamped ✓ rotation (-4°).

## Stage 3 — ROLL-OUT (harness → war room) · ~800ms
Press ENTER WAR ROOM →
1. Garage-door wipe: two #181818 panels part vertically (300ms).
2. **LIGHTS OUT strip**: five F1 start lights fill Rosso one per 90ms.
3. War room revealed; personas fly into the opinion map (staggered born
   animation, 400ms); round pill styled as LAP 0/12.
4. RUN button reads **LIGHTS OUT · GO** — pressing it extinguishes the five
   lights (the F1 start), and the first live round begins: the real thing.

## Implementation notes (next pass)
- `ignition.js` ~120 lines; CSS ~150 lines appended to the skin layer.
- Assembly-bay restyle is CSS-only over existing harness DOM (plates = the
  existing pipe-rows; fuel line = one absolutely-positioned div whose height
  binds to pipeline progress already streaming from Convex).
- War-room entry stagger: re-enable per-node born delay on first liveState.
- Order of build: Stage 1 overlay → Stage 2 bay skin → Stage 3 lights →
  Stage 0 polish. Each stage independently shippable and testable.
