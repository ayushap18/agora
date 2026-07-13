# AGORA × Ferrari design pass (branch: tier1)

Source: DESIGN-ferrari.md (cinematic editorial system).

## Token mapping
- Canvas #181818 (never pure black) · elevated #303030 · light theme = Ferrari's
  editorial white bands (#fff / #f7f7f7 / hairline #d2d2d2).
- **Rosso Corsa #da291c is CHROME ONLY** (CTAs, marks, highlights) — data colors
  (support blue / oppose red diverging scale) stay untouched; simulation truth
  never wears brand paint.
- Type: system sans at Ferrari weights (display 500 never bold, body 400,
  buttons 700 uppercase 1.4px tracking, nav 600 uppercase 0.65px).
- Radius 0 everywhere except badge pills. Hairlines + one soft shadow tier.

## Pages
1. **Landing = cinema page**: 64px Ferrari nav (uppercase links: HOME · HARNESS
   · SETTINGS · WAR ROOM, theme switch, GitHub) → full-viewport hero (particle
   field retinted to Rosso/ink on #181818, ignition reveal animation, tachometer
   tick sweep) → spec-cell band (80px numerals: personas / MC futures / rounds)
   → decision "garage" band (feature cards with red-bar hover reveal, Ferrari
   inputs, START THE ENGINE primary CTA) → dashboard as editorial band
   (race-calendar rows, hairline dividers).
2. **Harness / War room / Settings**: inherit the token swap automatically;
   same nav links for one-click access between all surfaces (the "faster
   access" requirement); war-room canvases stay cinematic dark plates even in
   light theme (photographic-depth rule).
3. **Theme switch**: dark ↔ light via [data-theme], persisted in localStorage;
   charts read CSS vars and adapt; canvas plates pinned dark.

## Hover vocabulary (the "multiple hover buttons")
- Primary CTA: Rosso gradient (180deg #a00c01→#da291c 64%) on hover.
- Outline CTA: fills ink, text inverts.
- Feature cards: translateY(-4px) + soft shadow + 2px red top-bar scale-in.
- Nav links: red underline sweep. Run rows: elevated background + red left rule.

## Dead code removal (main.js)
Delete the retired in-browser engine: Sim class, startRun/tick/narrate,
legacy renderers (drawMap/renderTally/renderRiver/renderDiverge/renderFeed/
renderFrame/renderAll), legacy nodeHit + listeners, estimateFlips/cloneSim/
local fork, legacy rAF loop. Keep: DECISIONS templates, bgnet (hero field),
helpers (mulberry32/hash01/stanceColor/el/$/esc), enterForkUI/exitForkUI.
Overrides converted to owned declarations before deleting their originals.

## Sequencing note
Angular port deliberately deferred: design layer first (this pass), framework
port as its own branch afterward if still wanted.
