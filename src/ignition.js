// Ignition sequence: one overlay, CSS keyframes, JS only orchestrates timing.
// Every sequence is skippable on click and collapses to an instant cut under
// prefers-reduced-motion. Animations mask latency (work starts at t=0).
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let overlay = null;
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'ignition';
  overlay.innerHTML = `
    <div class="door top"></div><div class="door bot"></div>
    <div class="ign-center">
      <div class="ign-mark">A</div>
      <div class="rpm"></div>
      <div class="ign-caption"></div>
      <div class="lights"><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;
  document.body.append(overlay);
  const rpm = overlay.querySelector('.rpm');
  for (let i = 0; i < 48; i++) rpm.append(document.createElement('i'));
  overlay.addEventListener('click', () => overlay.dispatchEvent(new Event('skip')));
  return overlay;
}

function play(script, onDone) {
  // script: [{at, fn}] ms-offset actions; skip/reduced → jump to end
  const ov = ensureOverlay();
  const timers = [];
  const finish = () => {
    timers.forEach(clearTimeout);
    ov.classList.remove('on', 'fire', 'shake', 'doors-open');
    ov.querySelectorAll('.rpm i, .lights i').forEach((x) => x.classList.remove('lit'));
    ov.removeEventListener('skip', finish);
    onDone && onDone();
  };
  if (reduced) { onDone && onDone(); return; }
  ov.addEventListener('skip', finish, { once: true });
  script.forEach(({ at, fn }) => timers.push(setTimeout(fn, at)));
  const end = Math.max(...script.map((s) => s.at)) + 60;
  timers.push(setTimeout(finish, end));
}

// Stage 1 — CRANK: garage → assembly bay (~900ms)
export function crank(onDone) {
  const ov = ensureOverlay();
  const ticks = [...ov.querySelectorAll('.rpm i')];
  const cap = ov.querySelector('.ign-caption');
  const CAPS = ['FUEL · REAL SOCIAL POSTS', 'SPARK · COHORTS', 'TORQUE · SYNTHETIC GRID'];
  ov.querySelector('.lights').style.display = 'none';
  ov.querySelector('.rpm').style.display = 'flex';
  const script = [{ at: 0, fn: () => { ov.classList.add('on'); cap.textContent = CAPS[0]; } }];
  ticks.forEach((t, i) => script.push({ at: 30 + i * 8, fn: () => t.classList.add('lit') }));
  script.push({ at: 170, fn: () => cap.textContent = CAPS[1] });
  script.push({ at: 330, fn: () => cap.textContent = CAPS[2] });
  script.push({ at: 440, fn: () => ov.classList.add('fire', 'shake') });
  script.push({ at: 700, fn: () => ov.classList.add('doors-open') });
  play(script.concat([{ at: 950, fn: () => {} }]), onDone);
}

// Stage 3 — LIGHTS OUT: harness → war room (~850ms)
export function lightsOut(onDone) {
  const ov = ensureOverlay();
  const lights = [...ov.querySelectorAll('.lights i')];
  ov.querySelector('.rpm').style.display = 'none';
  ov.querySelector('.lights').style.display = 'flex';
  const cap = ov.querySelector('.ign-caption');
  const script = [{ at: 0, fn: () => { ov.classList.add('on'); cap.textContent = 'LIGHTS OUT'; } }];
  lights.forEach((l, i) => script.push({ at: 80 + i * 90, fn: () => l.classList.add('lit') }));
  script.push({ at: 600, fn: () => ov.classList.add('doors-open') });
  play(script.concat([{ at: 880, fn: () => {} }]), onDone);
}

// GO: extinguish the five lights (F1 start) — used when RUN is pressed
export function goLights(onDone) {
  const ov = ensureOverlay();
  const lights = [...ov.querySelectorAll('.lights i')];
  ov.querySelector('.rpm').style.display = 'none';
  ov.querySelector('.lights').style.display = 'flex';
  const cap = ov.querySelector('.ign-caption');
  const script = [
    { at: 0, fn: () => { ov.classList.add('on'); cap.textContent = ''; lights.forEach((l) => l.classList.add('lit')); } },
    { at: 340, fn: () => { lights.forEach((l) => l.classList.remove('lit')); cap.textContent = 'GO'; } },
    { at: 520, fn: () => ov.classList.add('doors-open') },
  ];
  play(script.concat([{ at: 700, fn: () => {} }]), onDone);
}

// Stage 0 — engine-catch shudder on the hero (landing → garage handled by caller)
export function shudder(el) {
  if (reduced || !el) return;
  el.classList.add('shudder');
  setTimeout(() => el.classList.remove('shudder'), 360);
}
