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

/* ═══ ENGINE START FILM — vanilla port of the 13s timeline film, cut at 10.2s ═══
   Scenes: bloom+rings → systems check (app lamps) → IGNITION line → streaks
   → rosso wipe → pit wall handoff. Skippable (button/Escape/click), hard
   timeout fallback, reduced-motion = instant cut. */
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp01=t=>t<0?0:t>1?1:t;
const ez={
  outQuad:t=>t*(2-t), inQuad:t=>t*t, outCubic:t=>(--t)*t*t+1,
  outExpo:t=>t===1?1:1-Math.pow(2,-10*t),
  inCubic:t=>t*t*t, outQuint:t=>1+(--t)*t*t*t*t,
  inOutQuart:t=>t<.5?8*t*t*t*t:1-8*(--t)*t*t*t,
};
// piecewise interpolate([t...],[v...],[ease...])(t)
function interp(ts,vs,es){return t=>{
  if(t<=ts[0])return vs[0];
  if(t>=ts[ts.length-1])return vs[vs.length-1];
  for(let i=0;i<ts.length-1;i++)if(t>=ts[i]&&t<=ts[i+1]){
    const u=clamp01((t-ts[i])/(ts[i+1]-ts[i]));
    const e=(es&&(es[i]||es[0]))||(x=>x);
    return lerp(vs[i],vs[i+1],e(u));
  }
  return vs[vs.length-1];
}}
const anim=(f,to,s,e,ease)=>interp([s,e],[f,to],[ease]);
const frnd=i=>{const x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x)};

const LAMPS=['CORPUS','COHORTS','GRID','GRAPH','ENGINE','VOICES','LIVE'];

export function engineFilm(onLand){
  if(reduced){onLand();return}
  let done=false;
  const finish=()=>{                    // skip = fast rosso wipe L→R, land under cover
    if(done)return;done=true;
    clearTimeout(hardStop);
    const wipe=root.querySelector('.ef-wipe');
    root.querySelectorAll('.ef-lamps,.ef-ignite,.ef-streaks,.ef-skip,.ef-bloom,.ef-rumble')
      .forEach(x=>x.style.display='none');
    wipe.style.transition='transform .34s cubic-bezier(.55,0,.45,1)';
    wipe.style.transform='translateX(-28vw) skewX(-12deg)';        // covers screen
    setTimeout(()=>{
      onLand();
      root.style.background='transparent';
      wipe.style.transition='transform .3s cubic-bezier(.55,0,.45,1)';
      wipe.style.transform='translateX(120vw) skewX(-12deg)';      // exits right
      setTimeout(()=>root.remove(),340);
    },360);
  };
  const R='#da291c',DEEP='#a00c01',HAIR='#303030';
  const root=document.createElement('div');
  root.style.cssText='position:fixed;inset:0;z-index:120;background:#181818;overflow:hidden;font-family:system-ui,sans-serif;cursor:pointer';
  root.innerHTML=`
    <div class="ef-shake" style="position:absolute;inset:0">
      <div class="ef-bloom" style="position:absolute;left:50%;top:50%;width:80vmin;height:80vmin;transform:translate(-50%,-50%);pointer-events:none;background:radial-gradient(circle,rgba(218,41,28,.5) 0%,rgba(218,41,28,0) 62%);opacity:0"></div>
      <div class="ef-ring r1" style="position:absolute;left:50%;top:50%;width:180px;height:180px;margin:-90px;border-radius:9999px;border:2px solid rgba(218,41,28,.9);opacity:0"></div>
      <div class="ef-ring r2" style="position:absolute;left:50%;top:50%;width:180px;height:180px;margin:-90px;border-radius:9999px;border:2px solid rgba(218,41,28,.9);opacity:0"></div>
      <div class="ef-lamps" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;opacity:0">
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:56px;height:1px;background:${HAIR}"></div>
          <div style="font-size:12px;font-weight:600;letter-spacing:3.2px;color:#969696;text-transform:uppercase">Systems check</div>
          <div style="width:56px;height:1px;background:${HAIR}"></div>
        </div>
        <div class="ef-lamprow" style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;padding:0 24px"></div>
      </div>
      <div class="ef-ignite" style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:40px;opacity:0">
        <div class="ef-word" style="font-size:24px;font-weight:500;color:#fff;text-transform:uppercase;letter-spacing:8px">Ignition</div>
        <div class="ef-line" style="width:min(1100px,86vw);height:2px;background:${R};transform:scaleX(0);box-shadow:0 0 18px rgba(218,41,28,.85)"></div>
      </div>
      <div class="ef-rumble" style="position:absolute;bottom:-30vh;left:50%;width:120vw;height:70vh;transform:translateX(-50%);opacity:0;pointer-events:none;background:radial-gradient(ellipse at center,rgba(218,41,28,.55) 0%,rgba(218,41,28,0) 62%)"></div>
      <div class="ef-streaks" style="position:absolute;inset:0;overflow:hidden;opacity:0"></div>
      <div class="ef-flash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none"></div>
      <div class="ef-wipe" style="position:absolute;top:-8vh;left:0;width:300vw;height:120vh;transform:translateX(-300vw) skewX(-12deg);background:linear-gradient(90deg,#6d0c04 0%,${DEEP} 30%,${R} 78%,#e8452f 100%)">
        <div style="position:absolute;right:0;top:0;bottom:0;width:4px;background:rgba(255,255,255,.95);box-shadow:0 0 34px rgba(255,255,255,.9)"></div>
      </div>
    </div>
    <div class="ef-skip" style="position:absolute;right:26px;top:22px;padding:10px 20px;border:1px solid ${HAIR};font-size:11px;font-weight:600;letter-spacing:2.2px;color:#969696;text-transform:uppercase;background:rgba(255,255,255,.03);cursor:pointer;z-index:2">Skip →</div>`;
  document.body.append(root);
  const $q=c=>root.querySelector(c);
  const lampRow=$q('.ef-lamprow');
  const lampEls=LAMPS.map((label,i)=>{
    const last=i===LAMPS.length-1;
    const d=document.createElement('div');
    d.style.cssText=`width:112px;height:80px;border:1px solid ${HAIR};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px`;
    d.innerHTML=`<div class="bar" style="width:38px;height:4px;background:#242424"></div>
      <div class="lab" style="font-size:11px;font-weight:600;letter-spacing:1.6px;color:#4a4a4a">${label}</div>`;
    lampRow.append(d);
    return {d,bar:d.querySelector('.bar'),lab:d.querySelector('.lab'),c:last?R:'#fff',last};
  });
  // streaks (deterministic)
  const streakEls=[];
  const sBox=$q('.ef-streaks');
  for(let i=0;i<30;i++){
    const s=document.createElement('div');
    const red=frnd(i+170)<.3;
    s.style.cssText=`position:absolute;top:${3+frnd(i)*94}%;height:${1.5+frnd(i+90)*3}px;width:${12+frnd(i+50)*26}vw;border-radius:2px;background:linear-gradient(90deg,${red?R:'#fff'},rgba(255,255,255,0));opacity:0;box-shadow:${red?'0 0 14px rgba(218,41,28,.7)':'0 0 10px rgba(255,255,255,.3)'}`;
    sBox.append(s);
    streakEls.push({s,spd:1500+frnd(i+130)*2400,phase:frnd(i+210)*2600,op:.2+frnd(i+250)*.55});
  }
  const W=innerWidth;
  const t0=performance.now();
  const hardStop=setTimeout(finish,10600);   // rAF stalled? land anyway
  root.addEventListener('click',finish);
  const escH=e=>{if(e.key==='Escape')finish()};
  window.addEventListener('keydown',escH,{once:true});

  let landed=false;
  (function frame(){
    if(done)return;
    const t=(performance.now()-t0)/1000;
    // scene 0: bloom + rings
    $q('.ef-bloom').style.opacity=interp([0,.2,.85],[0,.8,0])(t);
    [[.04,'.r1',4.4],[.16,'.r2',3.2]].forEach(([s0,cls,g])=>{
      const el=$q(cls);
      const on=t>s0&&t<s0+.9;
      el.style.opacity=on?anim(.85,0,s0,s0+.85,ez.outQuad)(t):0;
      if(on)el.style.transform=`scale(${anim(1,g,s0,s0+.85,ez.outCubic)(t)})`;
    });
    // scene 1: lamps 1.25–4.5 (local L=t-1.25)
    const L=t-1.25;
    const lamps=$q('.ef-lamps');
    lamps.style.opacity=anim(0,1,.05,.35,ez.outCubic)(L)*anim(1,0,2.95,3.2,ez.inQuad)(L);
    lamps.style.transform=`translateY(${anim(14,0,.05,.5,ez.outCubic)(L)}px)`;
    lampEls.forEach((o,i)=>{
      const s0=.45+i*.24;
      let on=false;
      if(L>=s0){
        if(L>=2.5&&L<2.58)on=false;                       // unison blink
        else if(L<s0+.5)on=frnd(i*37+Math.floor((L-s0)*28)*7)>.42;  // flicker
        else on=true;
      }
      o.bar.style.background=on?o.c:'#242424';
      o.bar.style.boxShadow=on?`0 0 14px ${o.c}`:'none';
      o.lab.style.color=on?(o.last?R:'#fff'):'#4a4a4a';
      o.d.style.background=on?'rgba(255,255,255,.035)':'rgba(255,255,255,.015)';
    });
    // scene 2: ignition 4.35–6.5 (I=t-4.35)
    const I=t-4.35;
    const ig=$q('.ef-ignite');
    ig.style.opacity=I>0&&t<6.6?1:0;
    if(I>0){
      $q('.ef-line').style.transform=`scaleX(${anim(0,1,.05,.55,ez.outExpo)(I)})`;
      $q('.ef-line').style.height=interp([.5,1.6,2],[2,4,6])(I)+'px';
      const w=$q('.ef-word');
      w.style.opacity=anim(0,1,.35,.7)(I);
      w.style.letterSpacing=interp([.3,2],[8,18])(I)+'px';
      $q('.ef-rumble').style.opacity=interp([.4,1,2.1],[0,.65,.9])(I)*(0.6+0.25*Math.sin(I*38));
    }else $q('.ef-rumble').style.opacity=0;
    // scene 3: streaks 6.3–9.75 (S=t-6.3)
    const S=t-6.3;
    sBox.style.opacity=S>0?anim(0,1,0,.3)(S):0;
    if(S>0){
      sBox.style.transform=`scale(${interp([0,3.2],[1,1.3],[ez.inQuad])(S)})`;
      const accel=.55+.45*S;
      streakEls.forEach(o=>{
        const x=W*1.1-((S*o.spd*accel+o.phase)%(W*1.5));
        o.s.style.transform=`translateX(${x}px)`;
        o.s.style.opacity=o.op;
      });
    }
    // white flash at 6.3
    $q('.ef-flash').style.opacity=interp([6.22,6.36,6.62],[0,.85,0])(t);
    // camera shake 4.5–9.95
    const ampl=interp([4.5,5.3,6.3,7.6,9.3,9.95],[0,6,8,5,4,0])(t);
    $q('.ef-shake').style.transform=
      `translate(${ampl*Math.sin(t*91.3)*Math.sin(t*23.7)}px,${ampl*.7*Math.sin(t*77.1+1.7)*Math.sin(t*31.3)}px)`;
    // wipe 8.9→10.2 — land pit wall while covered (~9.6s)
    const wx=interp([8.95,9.5,9.85,10.2],[-3,-.6,-.28,1.2],[ez.inCubic,x=>x,ez.inOutQuart])(t);
    $q('.ef-wipe').style.transform=`translateX(${wx*100}vw) skewX(-12deg)`;
    if(t>9.6&&!landed){landed=true;root.style.background='transparent';
      $q('.ef-streaks').style.display='none';$q('.ef-ignite').style.display='none';
      onLand();}
    if(t>=10.25){done=true;clearTimeout(hardStop);
      root.style.transition='opacity .2s';root.style.opacity='0';
      setTimeout(()=>root.remove(),250);return}
    requestAnimationFrame(frame);
  })();
  return {seek:null};
}
