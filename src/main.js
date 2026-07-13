import { client, api } from './convexClient.js';
import { crank, lightsOut, goLights, shudder, engineFilm } from './ignition.js';

'use strict';
/* ═══════════════════════════ deterministic core ═══════════════════════════
   Same state shape as the Convex schema (runs/personas/edges/stances/factions/
   events) so the engine swaps for useQuery(api.sim.liveState) without a UI
   rewrite. Everything is seeded → any tab with (seed, decision, count) rebuilds
   the identical population; only stance vectors travel between tabs. */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const pct=v=>Math.round(v*100);

const FIRST=['Maya','Arjun','Lena','Tomás','Priya','Jonas','Aisha','Derek','Sofia','Kenji','Nadia','Marcus','Ingrid','Ravi','Chloe','Omar','Tessa','Felix','Zara','Ivan','Amara','Noel','Yuki','Dana','Silas','Rhea','Colin','Fatima','Emil','Josie','Anders','Lila'];
const LAST=['Okafor','Lindqvist','Reyes','Tanaka','Novak','Mehta','Boateng','Kowalski','Ferreira','Haddad','Ström','Iyer','Marchetti','Osei','Byrne','Vargas','Klein','Ahmadi','Dubois','Nakamura','Petrov','Ortiz','Werner','Chowdhury','Eze','Halvorsen','Rossi','Sato','Nkemelu','Bianchi','Farrell','Kaur'];

/* cohort: share, base stance, volatility, influence multiplier, arg tags, quotes, faction names */
const DECISIONS=[
{ id:'rto', title:'Mandate 4 office days per week, effective next quarter',
  sub:'company-wide return-to-office policy · 1,900 employees', nCohorts:7,
  text:'Effective next quarter, all employees must work from the office 4 days per week. Remote-work exceptions are discontinued. Badge data will be reviewed monthly by people-ops.',
  amendments:[
   {label:'Grandfather remote-hired employees',detail:'anyone hired under a remote contract keeps it'},
   {label:'Reduce to 2 anchor days',detail:'team-chosen anchor days, no badge reviews'},
   {label:'Commuter stipend + on-site childcare',detail:'$350/mo transit + childcare pilot at HQ'}]},
{ id:'fare', title:'Raise metro fares 40% and retire monthly passes',
  sub:'city transit authority · 310k daily riders', nCohorts:7,
  text:'To close the operating deficit, single fares rise 40% next quarter and the discounted monthly pass program is retired. Revenue is earmarked for signal modernization.',
  amendments:[
   {label:'Keep monthly passes at +15%',detail:'pass survives, priced up moderately'},
   {label:'Night & off-peak fare freeze',detail:'no increase 9pm–6am and weekends'},
   {label:'Income-based fare cap',detail:'monthly spend capped at 3% of documented income'}]},
{ id:'ai', title:'Require AI-assistance disclosure on all student coursework',
  sub:'university senate policy · 28k students, 1,600 faculty', nCohorts:7,
  text:'All submitted coursework must declare every AI tool used and attach full prompt logs. Undeclared AI use is treated as academic dishonesty with a one-strike suspension policy.',
  amendments:[
   {label:'Drop prompt logs, keep tool declaration',detail:'declare tools used; logs never collected'},
   {label:'Replace one-strike with graduated response',detail:'warning → resubmission → hearing'},
   {label:'Course-level opt-in instead of blanket rule',detail:'instructors choose per course'}]}
];



/* ─── simulation (LEGACY in-browser engine: unreachable, kept only as the renderer
   shape reference — delete after the hackathon) ─── */

/* ─── app state ─── */
const S={sim:null,alt:null,running:false,speed:1,view:0,scrubbed:false,
  events:[],decisionIdx:0,seed:0,count:1800,mirror:false,forkLabel:''};
const $=id=>document.getElementById(id);
const el=(t,cls,html)=>{const e=document.createElement(t);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e};

/* ─── setup view wiring ─── */
const samplesBox=$('samples');
const ICONS={rto:'🏢',fare:'🚇',ai:'🎓'};
DECISIONS.forEach((d,i)=>{
  const b=el('button','sample',
    `<span class="pick">✓</span><div class="ic">${ICONS[d.id]||'◈'}</div><b>${d.title}</b>
     <div class="meta">${d.sub}<br>${d.nCohorts} cohorts · ${d.amendments.length} draft amendments</div>`);
  b.onclick=()=>{S.decisionIdx=i;$('decisionText').value=d.text;$('decisionTitle').value=d.title;
    [...samplesBox.children].forEach((c,j)=>c.classList.toggle('sel',j===i));};
  samplesBox.append(b);
});
samplesBox.children[0].click();
$('popSize').oninput=e=>{$('popOut').textContent=e.target.value;S.count=+e.target.value;
  const pb=$('populateBtn');
  if(pb&&!pb.textContent.includes('✓')&&!pb.textContent.includes('…'))
    pb.textContent=`③ Build network — ${S.count} personas`;};

const dz=$('dropzone');
dz.onclick=()=>$('fileInput').click();
dz.ondragover=e=>{e.preventDefault();dz.classList.add('on')};
dz.ondragleave=()=>dz.classList.remove('on');
dz.ondrop=e=>{e.preventDefault();dz.classList.remove('on');groundFile(e.dataTransfer.files[0])};
$('fileInput').onchange=e=>groundFile(e.target.files[0]);
function groundFile(f){
  if(!f)return;
  const ok=$('groundOk');ok.style.display='flex';ok.innerHTML='';
  const reader=new FileReader();
  reader.onload=()=>{
    const rows=String(reader.result).split('\n').filter(x=>x.trim()).length;
    ok.append(el('span','chip',`✓ ${f.name}`),
      el('span','chip',`${rows} rows → grievance embeddings`),
      el('span','chip','vector index seeded'));
    dz.innerHTML='<strong>Grounded.</strong> Personas will cite this corpus.';
  };
  reader.readAsText(f.slice(0,200000));
}

/* ─── boot a run ─── */
$('materializeBtn').onclick=()=>{openHarness();crank(()=>{});};

/* fork view chrome (shared by the convex fork path) */
function enterForkUI(){
  $('mapCardB').style.display='flex';
  $('mapALabel').textContent='Baseline · no amendment';
  $('mapBLabel').textContent=S.forkLabel;
  $('divergeCard').style.display='block';
  $('tallyFork').style.display='block';
  sizeCanvases();
}
function exitForkUI(){
  $('mapCardB').style.display='none';
  $('mapALabel').textContent='Opinion space · live population';
  $('divergeCard').style.display='none';
  $('tallyFork').style.display='none';
}

/* ─── verdict ─── */

/* modal close plumbing */
function closeModals(){document.querySelectorAll('.overlay').forEach(o=>o.classList.remove('open'))}
document.addEventListener('click',e=>{
  if(e.target.matches('[data-close]')||e.target.classList.contains('overlay'))closeModals()});

/* ═══════════════════════════ rendering ═══════════════════════════ */
const cvA=$('mapA'),cvB=$('mapB');
function sizeCanvases(){
  [cvA,cvB].forEach(cv=>{
    const r=cv.getBoundingClientRect();
    if(r.width<10)return;
    cv.width=r.width*devicePixelRatio;cv.height=r.height*devicePixelRatio;
  });
}
window.addEventListener('resize',()=>{sizeCanvases()});

function stanceColor(s,alpha=1){
  // diverging blue↔red through neutral gray
  const t=(clamp(s,-1,1)+1)/2;
  const mix=(a,b,u)=>Math.round(a+(b-a)*u);
  let r,g,bl;
  if(t<.5){const u=t*2;r=mix(230,85,u);g=mix(103,84,u);bl=mix(103,78,u)}
  else{const u=(t-.5)*2;r=mix(85,57,u);g=mix(84,135,u);bl=mix(78,229,u)}
  return`rgba(${r},${g},${bl},${alpha})`;
}



/* node popover (drill-down) */
document.addEventListener('click',e=>{
  if(!e.target.closest('#pop')&&!e.target.closest('canvas'))$('pop').style.display='none'});

/* tallies */

/* opinion-drift river (stacked shares, 2px surface gaps, hover crosshair) */

/* fork divergence — two approval lines, direct-labeled */

/* factions strips */

/* feed */

/* scrubber */
const scrub=$('scrub');


/* ambient landing background — a quiet population slowly polarizing */
(function bgnet(){
  const cv=$('bgnet');if(!cv)return;
  const ctx=cv.getContext('2d');
  let W,H;
  const fit=()=>{W=cv.width=innerWidth*devicePixelRatio;H=cv.height=innerHeight*devicePixelRatio};
  fit();addEventListener('resize',fit);
  const R=mulberry32(7),N=72,pts=[];
  for(let i=0;i<N;i++)pts.push({x:R(),y:R(),a:R()*Math.PI*2,
    sp:.002+R()*.003,side:i%2?1:-1,r:(1.2+R()*1.6)});
  (function frame(){
    requestAnimationFrame(frame);
    if(!$('setup').classList.contains('active'))return;
    ctx.clearRect(0,0,W,H);
    const dpr=devicePixelRatio;
    for(const p of pts){
      p.a+=p.sp;
      p.x+=Math.cos(p.a)*.0007+p.side*.00009; // slow drift toward its pole
      p.y+=Math.sin(p.a*.83)*.0006;
      if(p.x<-.04)p.x=1.04;if(p.x>1.04)p.x=-.04;
      if(p.y<-.04)p.y=1.04;if(p.y>1.04)p.y=-.04;
    }
    const max=(120*dpr)**2;
    for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
      const dx=(pts[i].x-pts[j].x)*W,dy=(pts[i].y-pts[j].y)*H,d2=dx*dx+dy*dy;
      if(d2<max){
        ctx.strokeStyle=`rgba(160,160,160,${.05*(1-d2/max)})`;
        ctx.lineWidth=dpr*.7;
        ctx.beginPath();ctx.moveTo(pts[i].x*W,pts[i].y*H);ctx.lineTo(pts[j].x*W,pts[j].y*H);ctx.stroke();
      }
    }
    for(const p of pts){
      const col=p.side>0?'218,41,28':'150,150,150';
      ctx.fillStyle=`rgba(${col},${p.side>0?.55:.4})`;
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,p.r*dpr,0,7);ctx.fill();
    }
  })();
})();


/* ═══════════════════════════ HARNESS CONSOLE (Convex-backed) ═══════════════════════════ */
const QUERY_DEFAULTS={rto:'return to office mandate',fare:'transit fare increase',ai:'AI homework policy university'};
const PLATFORMS=[
  {id:'reddit',label:'reddit',icon:'🟠'},
  {id:'hn',label:'hacker news',icon:'🟧'},
  {id:'bluesky',label:'bluesky',icon:'🦋'},
  {id:'mastodon',label:'mastodon',icon:'🐘'},
];
const H={sourceStatus:{},cohorts:[],decisionDocId:null};

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));
}

function openHarness(){
  showView('harness');
  H.harnessTs=Date.now();   // distill scopes to posts fetched in this session
  const d=DECISIONS[S.decisionIdx];
  const title=$('decisionTitle').value.trim()||d.title;
  $('harnessSub').textContent=title;
  const q=title===d.title?(QUERY_DEFAULTS[d.id]||title):title;
  $('srcRows').innerHTML='';
  PLATFORMS.forEach(p=>{
    const row=el('div','src-row',
      `<span class="plat">${p.icon} ${p.label}</span>
       <input value="${q}" data-plat="${p.id}">
       <button class="btn" data-fetch="${p.id}">Fetch</button>
       <span class="chip" data-status="${p.id}">idle</span>`);
    $('srcRows').append(row);
  });
  document.querySelectorAll('[data-fetch]').forEach(b=>{
    b.onclick=async()=>{
      const plat=b.dataset.fetch;
      const input=document.querySelector(`input[data-plat="${plat}"]`);
      if(!input.value.trim())return;
      b.disabled=true;
      try{await client.mutation(api.ingest.start,{platform:plat,query:input.value.trim()});}
      catch(e){console.error(e)}
      b.disabled=false;
    };
  });
}
$('harnessBack').onclick=()=>showView('setup');
$('xImportBtn').onclick=async()=>{
  const t=$('xImport').value.trim();if(!t)return;
  const b=$('xImportBtn');b.disabled=true;
  try{
    const r=await client.mutation(api.ingest.importX,{text:t});
    $('xImport').value='';
    b.textContent=`Imported ${r.count} ✓`;
    setTimeout(()=>{b.textContent='Import X posts'},2500);
  }catch(e){console.error(e);b.textContent='Import failed';
    setTimeout(()=>{b.textContent='Import X posts'},2500);}
  finally{b.disabled=false}
};

/* live subscriptions — every open screen sees the same pipeline */
client.onUpdate(api.pipeline.latest,{},rows=>{
  const rail=$('pipeRail');rail.innerHTML='<div class="fuel-fill"></div>';
  const LAYERS=['L0','L1','L1.5','L2','L3','L4','L5','L6'];
  const PARTS=['INTAKE','INJECTION','MIXTURE','BLOCK','DRIVETRAIN','COMBUSTION','EXHAUST NOTE','TELEMETRY'];
  const byLayer=Object.fromEntries(rows.map(r=>[r.layer,r]));
  let done=0;
  LAYERS.forEach((l,i)=>{
    const r=byLayer[l];
    if(r&&r.status==='done')done=i+1;
    const row=el('div','pipe-row '+(r?r.status:''),
      `<span class="lyr">${l}</span>
       <span class="det"><span class="part">AG-${l} · ${PARTS[i]}</span>${r?esc(r.detail):'awaiting torque'}</span>
       <span class="chip">${r?r.status:'idle'}</span>`);
    rail.append(row);
  });
  rail.querySelector('.fuel-fill').style.height=`calc((100% - 16px) * ${done/LAYERS.length})`;
});
client.onUpdate(api.ingest.sources,{},srcs=>{
  srcs.forEach(s=>{
    const chip=document.querySelector(`[data-status="${s.platform==='lemmy'?'reddit':s.platform}"]`);
    if(chip){chip.textContent=s.status==='done'?`${s.count} ✓`:s.status;
      chip.style.color=s.status==='failed'?'#f0a0a0':s.status==='done'?'var(--good)':'var(--ink-2)'}
  });
});
tickerUnsub=client.onUpdate(api.ingest.recentPosts,{limit:30},posts=>renderTickerPosts(posts));
client.onUpdate(api.ingest.postCount,{},n=>{$('postTotal').textContent=n+' posts in corpus'});

/* L1 distill wiring */
let cohortUnsub=null;
$('distillBtn').onclick=async()=>{
  const d=DECISIONS[S.decisionIdx];
  $('distillBtn').disabled=true;$('distillBtn').textContent='② Distilling…';
  try{
    const title=$('decisionTitle').value.trim()||d.title;
    const amendments=(title===d.title?d.amendments:[
      {label:'Exempt the most-affected group',detail:'full carve-out for the hardest-hit cohort'},
      {label:'Soften the rollout',detail:'phase in gradually with broad concessions'},
      {label:'Compensate the quietly hurt',detail:'targeted support for the voiceless cohort'},
    ]).map(a=>({label:a.label,detail:a.detail,fx:{}}));
    H.decisionDocId=await client.mutation(api.distill.seedDecision,{
      title,body:$('decisionText').value.trim()||d.text,amendments});
    if(cohortUnsub)cohortUnsub();
    cohortUnsub=client.onUpdate(api.distill.listCohorts,{decisionId:H.decisionDocId},renderCohorts);
    await client.action(api.distill.run,{decisionId:H.decisionDocId,sinceTs:H.harnessTs});
  }catch(e){console.error(e)}
  $('distillBtn').disabled=false;$('distillBtn').textContent='② Distill cohorts from corpus';
};
const COHORT_COLORS=['var(--c1)','var(--c2)','var(--c3)','var(--c4)','var(--c5)','var(--c6)','var(--c7)','var(--c8)'];
function renderCohorts(cs){
  H.cohorts=cs;
  $('cohortChip').textContent=cs.length?cs.length+' cohorts':'—';
  const box=$('cohortList');box.innerHTML='';
  if(!cs.length){box.innerHTML='<div style="padding:6px 14px;font-size:12px;color:var(--ink-3)">fetch sources, then distill</div>';return}
  cs.forEach(c=>{
    box.append(el('div','cohort-row',
      `<i style="width:9px;height:9px;border-radius:3px;background:${COHORT_COLORS[c.idx%8]};flex:none"></i>
       <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
       <span class="bar" style="max-width:70px"><i style="width:${Math.round(c.share*100)}%;background:${COHORT_COLORS[c.idx%8]}"></i></span>
       <span class="chip" style="color:${c.baseStance<-0.15?'var(--opp)':c.baseStance>0.15?'var(--sup)':'var(--ink-2)'}">${c.baseStance>=0?'+':''}${c.baseStance.toFixed(2)}</span>`));
  });
  if(!$('populateBtn').textContent.includes('✓'))$('populateBtn').disabled=false;
}

/* debug handles (module scope hides these otherwise) */
Object.assign(window,{S,H,client,api,showView,openHarness});

/* L2+L3 populate wiring */
$('populateBtn').onclick=async()=>{
  $('populateBtn').disabled=true;$('populateBtn').textContent=`③ Building ${S.count} personas…`;
  try{
    H.runId=await client.mutation(api.populate.run,{decisionId:H.decisionDocId,n:S.count});
    $('enterRoomBtn').disabled=false;
    $('populateBtn').textContent='③ Network built ✓';
  }catch(e){console.error(e);$('populateBtn').disabled=false;$('populateBtn').textContent='③ Build network — 1,800 personas'}
};

/* ═══════════════════════ WAR ROOM ON CONVEX (L6) ═══════════════════════
   The canvas/SVG renderers consume Sim-shaped objects; we feed them thin
   adapters built from reactive queries. The local engine no longer ticks. */
const hash01=i=>{let x=(i*2654435761)>>>0;x^=x>>13;x=(x*0x5bd1e995)>>>0;return((x^=x>>15)>>>0)/4294967296};

function makeAdapter(label){
  return {
    label,count:0,adj:[],personas:[],pos:[],factions:[],history:[],round:0,
    d:{cohorts:[]},
    stances(){return this._stances||[]},
    tick(){return false},                    // guards legacy space-bar handler
    tally(vals){const s=vals||this.stances();let sup=0,opp=0;
      for(const v of s){if(v>.12)sup++;else if(v<-.12)opp++}
      return{sup,opp,neu:s.length-sup-opp,n:s.length}},
    setMeta(meta){                            // one-time static payload (names/cohorts/inf/graph)
      this.meta=meta;this.bornAt=performance.now();
      const adj=[];meta.adj.forEach(ch=>{
        for(let i=0;i+1<ch.offsets.length;i++)adj.push(ch.flatAdj.slice(ch.offsets[i],ch.offsets[i+1]))});
      this.adj=adj;this.count=meta.names.length;
      // vertical bands sized by cohort share — dense cohorts get room to breathe
      const nc=Math.max(1,Math.max(...meta.cohortIdx)+1);
      const counts=new Array(nc).fill(0);
      meta.cohortIdx.forEach(ci=>counts[ci]++);
      const total=this.count||1,MINB=.05;
      const bands=counts.map(c2=>Math.max(MINB,c2/total));
      const bsum=bands.reduce((a,b)=>a+b,0);
      const starts=[];let acc=0;
      for(const b of bands){starts.push(acc/bsum);acc+=b}
      this.sizeK=Math.max(.5,Math.min(1.2,Math.sqrt(900/total)));
      this.personas=meta.cohortIdx.map((ci,i)=>({ci,inf:meta.inf[i],stance:0}));
      this.pos=meta.cohortIdx.map((ci,i)=>{
        const b=bands[ci]/bsum;
        return {y:starts[ci]+b*.06+hash01(i)*b*.88,x:0,jit:hash01(i*7+3)*Math.PI*2};
      });
    },
    applyLive(st){
      if(this.round!==st.run.round)this.edgesDirty=true;
      this._stances=st.stances;this.round=st.run.round;this.run=st.run;
      this.factions=st.factions;this.d.cohorts=st.cohorts.map(c=>({name:c.name}));
      if(this.personas.length===st.stances.length)
        this.personas.forEach((p,i)=>{p.stance=st.stances[i]});
    },
  };
}

const W={A:makeAdapter('baseline'),B:null,subs:[],timelineA:[],timelineB:[],feed:[],scrubbing:false,roundCache:{}};

function unsubAll(){
  try{stopPresence()}catch(e){}
  W.subs.forEach(u=>{try{u()}catch(e){}});W.subs=[];
  if(typeof estimatesUnsub==='function'){try{estimatesUnsub()}catch(e){}estimatesUnsub=null}
  if(typeof cohortUnsub==='function'){try{cohortUnsub()}catch(e){}cohortUnsub=null}
  if(typeof confUnsub==='function'){try{confUnsub()}catch(e){}confUnsub=null}
}

async function enterWarRoom(runId){
  unsubAll();
  W.A=makeAdapter('baseline');W.B=null;W.timelineA=[];W.timelineB=[];W.feed=[];W.roundCache={};
  W.scrubbing=false;W.scrubStances=null;W.revAdj=null;$('liveBtn').style.display='none';
  H.runId=runId;H.forkId=null;H.decision=null;
  S.sim=null;S.alt=null;S.scrubbed=false;  // legacy rAF loop stays dormant — cRaf owns the canvas
  exitForkUI();
  // reject dead/foreign run ids before wiring anything
  const probe=await client.query(api.serve.liveState,{runId}).catch(()=>null);
  if(!probe){history.replaceState(null,'',location.pathname);showView('setup');return}
  showView('room');
  $('speedBtn').style.display='none';       // pacing is server-owned now
  sizeCanvases();
  // static payload: names/cohorts/influence/graph — fetched once, hot sub stays slim
  client.query(api.serve.personaMeta,{runId}).then(meta=>{
    if(!meta)return;W.A.setMeta(meta);if(W.B&&!W.B.meta)W.B.setMeta(meta);
  });
  history.replaceState(null,'','#run='+runId); // shareable URL, no history spam
  let forkWatch=false;
  W.subs.push(client.onUpdate(api.serve.liveState,{runId},st=>{if(!st)return;
    W.A.applyLive(st);cRenderFrame();
    if(!forkWatch){forkWatch=true;H.decisionDocId=st.run.decisionId;
      client.query(api.serve.decision,{decisionId:st.run.decisionId}).then(d=>{
        if(d){H.decision=d;$('rtitle').textContent=d.title}}).catch(()=>{});
      W.subs.push(client.onUpdate(api.serve.runsForDecision,{decisionId:st.run.decisionId},runs=>{
        const fork=runs.find(r=>r.parentRunId===H.runId&&!r.label.startsWith('__'));
        if(fork&&!W.B)attachFork(fork._id,fork.amendment?fork.amendment.label:fork.label);
      }));}
  }));
  startPresence(runId);
  W.subs.push(client.onUpdate(api.serve.timeline,{runId},t=>{W.timelineA=t;cRenderCharts()}));
  W.subs.push(client.onUpdate(api.serve.feed,{runId},f=>{W.feed=f;cRenderFeed()}));
  $('rsub').textContent='grounded in real social posts · convex durable workflow';
}
function maybeAttachFork(){/* handled by runsForDecision sub */}

function attachFork(forkId,label){
  if(W.B)return;
  H.forkId=forkId;
  W.B=makeAdapter('amended');if(W.A.meta)W.B.setMeta(W.A.meta);
  S.forkLabel=label;
  enterForkUI();
  $('mapBLabel').textContent=label;
  if(!W.B.meta)client.query(api.serve.personaMeta,{runId:forkId}).then(m=>{if(m&&!W.B.meta)W.B.setMeta(m)});
  W.subs.push(client.onUpdate(api.serve.liveState,{runId:forkId},st=>{if(st)W.B.applyLive(st)}));
  W.subs.push(client.onUpdate(api.serve.timeline,{runId:forkId},t=>{W.timelineB=t;cRenderCharts()}));
}

/* render pipeline (replaces legacy renderAll for the convex path) */
function cRenderFrame(){
  const run=W.A.run;if(!run)return;
  $('roundPill').textContent=`LAP ${run.round}/${run.rounds}`;
  $('popChip').textContent=`${run.n} personas · live graph`;
  $('statusTxt').textContent=run.status==='running'?'LIVE':run.status.toUpperCase();
  $('statusDot').className='dot'+(run.status==='running'?' live':'');
  $('runBtn').innerHTML=run.status==='ready'?'Lights out · GO':run.status==='running'?'● LIVE':'▣ Finished';
  $('runBtn').disabled=run.status!=='ready';
  const lateFork=W.B||run.round>=run.rounds-2;
  $('interveneBtn').disabled=!!lateFork;
  $('interveneBtn').innerHTML=W.B?'⑂ Forked':lateFork?'⚡ Intervene (run ended)':'⚡ Intervene';
  if(!W.scrubbing){$('scrub').max=run.round;$('scrub').value=run.round;
    $('scrubLab').textContent=`round ${run.round} / ${run.round}`}
  cRenderTally();renderFactions();
}
function cRenderTally(){
  const t=W.A.tally();if(!t.n)return;
  const rows=[['Support',t.sup,'var(--sup)'],['Neutral',t.neu,'var(--neu)'],['Oppose',t.opp,'var(--opp)']];
  $('tallyRows').innerHTML=rows.map(([lab,n,col])=>`
    <div class="tally-row"><i style="width:10px;height:10px;border-radius:3px;background:${col}"></i>
      <span>${lab}</span><span class="bar"><i style="width:${n/t.n*100}%;background:${col}"></i></span>
      <span class="num"><b>${Math.round(n/t.n*100)}%</b> · ${n}</span></div>`).join('');
  $('apprChip').textContent=Math.round(t.sup/t.n*100)+'% approve';
  if(W.B&&W.B.run){
    const ta=W.B.tally();
    if(ta.n){const d=Math.round(ta.sup/ta.n*100)-Math.round(t.sup/t.n*100);
    $('tallyFork').innerHTML=`<b style="color:var(--ink)">⑂ Fork comparison</b>
      <div class="cmp"><span>Baseline approval</span><b>${Math.round(t.sup/t.n*100)}%</b></div>
      <div class="cmp"><span>Amended approval</span><b style="color:var(--sup)">${Math.round(ta.sup/ta.n*100)}% (${d>=0?'+':''}${d} pts)</b></div>`}
  }
}
function cRenderCharts(){
  // river from timeline tallies
  const tl=W.timelineA;if(!tl.length)return;
  const svg=$('river'),Wd=svg.clientWidth||330,Hh=128;
  svg.setAttribute('viewBox',`0 0 ${Wd} ${Hh}`);
  const n=tl.length,padL=6,padR=44,padT=6,padB=16,iw=Wd-padL-padR,ih=Hh-padT-padB;
  const shares=tl.map(t=>[t.sup/t.n,t.neu/t.n,t.opp/t.n]);
  const X=i=>padL+(n===1?iw/2:i/(n-1)*iw),Y=v=>padT+(1-v)*ih;
  const band=(lo,hi,color)=>{
    let d='M'+X(0)+','+Y(hi(0));
    for(let i=1;i<n;i++)d+='L'+X(i)+','+Y(hi(i));
    for(let i=n-1;i>=0;i--)d+='L'+X(i)+','+Y(lo(i));
    return`<path d="${d}Z" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`};
  const sup=i=>shares[i][0],neu=i=>shares[i][1];
  let out=band(i=>1-sup(i),i=>1,'var(--sup)')
        +band(i=>1-sup(i)-neu(i),i=>1-sup(i),'var(--neu)')
        +band(i=>0,i=>1-sup(i)-neu(i),'var(--opp)');
  const last=shares[n-1],yy=[1-last[0]/2,1-last[0]-last[1]/2,1-last[0]-last[1]-last[2]/2];
  ['Support','Neutral','Oppose'].forEach((lab,i)=>{
    if(last[i]<.04)return;
    out+=`<text x="${Wd-padR+5}" y="${Y(yy[i])+3}" font-size="9.5" fill="var(--ink-2)">${Math.round(last[i]*100)}%</text>`});
  out+=`<text x="${padL}" y="${Hh-4}" font-size="9" fill="var(--ink-3)">R0</text>
        <text x="${padL+iw-14}" y="${Hh-4}" font-size="9" fill="var(--ink-3)">R${n-1}</text>`;
  svg.innerHTML=out;
  // divergence
  if(W.B&&W.timelineB.length){
    $('divergeCard').style.display='block';
    const svg2=$('diverge'),W2=svg2.clientWidth||330,H2=104;
    svg2.setAttribute('viewBox',`0 0 ${W2} ${H2}`);
    const a=W.timelineA,b=W.timelineB,nn=a.length;
    const pL=6,pR=64,pT=8,pB=14,iw2=W2-pL-pR,ih2=H2-pT-pB;
    const X2=i=>pL+(nn===1?iw2/2:i/(nn-1)*iw2),Y2=v=>pT+(1-v)*ih2;
    const line=(arr,col,w)=>'<polyline fill="none" stroke="'+col+'" stroke-width="'+w+'" points="'
      +arr.map((t,i)=>X2(i)+','+Y2(t.sup/t.n)).join(' ')+'"/>';
    const la=a[a.length-1],lb=b[b.length-1];
    svg2.innerHTML=
      `<line x1="${pL}" x2="${pL+iw2}" y1="${Y2(.5)}" y2="${Y2(.5)}" stroke="var(--grid)" stroke-width="1"/>`
      +line(a,'var(--ink-3)',1.6)+line(b,'var(--sup)',2)
      +`<text x="${X2(a.length-1)+7}" y="${Y2(la.sup/la.n)+3}" font-size="9.5" fill="var(--ink-3)">base ${Math.round(la.sup/la.n*100)}%</text>
        <text x="${X2(b.length-1)+7}" y="${Y2(lb.sup/lb.n)+3}" font-size="9.5" fill="var(--sup)">fork ${Math.round(lb.sup/lb.n*100)}%</text>`;
  }
}
function cRenderFeed(){
  const feed=$('feed');feed.innerHTML='';
  W.feed.forEach(e=>{
    if(e.type==='voice'){
      const cls=e.kind==='dissent'?'ev dissent':e.kind==='synthesis'?'ev beat':'ev';
      const d=el('div',cls,
        e.kind==='dissent'
          ?`⚠ <span class="tag">DISSENT AGENT</span> ${esc(e.text)}`
          :e.kind==='synthesis'
          ?`◆ <span class="tag" style="color:var(--warning)">ROUND ${e.round}</span> ${esc(e.text)}`
          :`<div class="who"><b>${esc(e.name)}</b><span class="chip">${esc(e.cohort)}</span>
             <span class="stance-chip" style="color:${stanceColor(e.stance)}">${e.stance>=0?'+':''}${e.stance.toFixed(2)}</span></div>
            “${esc(e.text)}”<div style="font-size:10px;color:var(--ink-3);margin-top:3px">round ${e.round}</div>`);
      feed.append(d);
    }else{
      const msg=e.kind==='fork'?`⑂ <b>TIMELINE FORKED</b> at round ${e.round} — ${e.payload.label}`
        :e.kind==='start'?'▶ <b>Simulation started</b> — durable workflow running'
        :e.kind==='complete'?'▣ <b>Simulation complete</b> — open the Verdict'
        :e.kind;
      feed.append(el('div','ev sys',msg));
    }
  });
}

/* controls */
$('enterRoomBtn').onclick=()=>{enterWarRoom(H.runId);lightsOut(()=>{});};
$('runBtn').onclick=async()=>{
  if(!W.A.run||W.A.run.status!=='ready')return;
  $('runBtn').disabled=true;                       // double-fire guard; sub re-renders state
  goLights(()=>{});                                // F1 start: five lights out, GO
  await client.mutation(api.sim.start,{runId:H.runId}).catch(console.error);
};
$('resetBtn').onclick=()=>{unsubAll();history.replaceState(null,'',location.pathname);showView('setup')};
$('interveneBtn').onclick=()=>{
  if(W.B){cToast('One fork per run — reset for a fresh branch.');return}
  const run=W.A.run;
  if(!run||run.round>=run.rounds-2){cToast('Too late to fork — fewer than 2 rounds left.');return}
  const list=$('amendList');list.innerHTML='';
  const amendments=(H.decision&&H.decision.amendments&&H.decision.amendments.length?H.decision.amendments:DECISIONS[S.decisionIdx].amendments);
  const MODES=['grandfather','soften','compensate'].slice(0,amendments.length).map((m,i)=>[m,amendments[i]]);
  MODES.forEach(([mode,a])=>{
    const b=el('button','amend',
      `<div><b>${a.label}</b><div style="color:var(--ink-3);font-size:11.5px;margin-top:2px">${a.detail}</div></div>
       <span class="fx"><b>fork</b>timeline</span>`);
    b.onclick=async()=>{closeModals();
      if(W.B||W.forkInFlight)return;W.forkInFlight=true;
      try{await client.mutation(api.sim.fork,{runId:H.runId,label:a.label,mode})}
      finally{W.forkInFlight=false}};
    list.append(b);
  });
  $('interveneModal').classList.add('open');
};
$('customForkBtn').onclick=async()=>{
  const t=$('amendCustom').value.trim();if(!t||W.B||W.forkInFlight)return;
  closeModals();W.forkInFlight=true;cToast('🧠 model is mapping your amendment onto the cohorts…');
  try{const r=await client.action(api.sim.customForkPublic,{runId:H.runId,label:t});
    cToast(r.llm?'⑂ forked — LLM assigned cohort effects':'⑂ forked — heuristic effects (no model key)')}
  catch(e){console.error(e)}
  finally{W.forkInFlight=false}
};
function cToast(msg){$('feed').prepend(el('div','ev sys',msg))}

/* scrubber → historical rounds from convex */
$('scrub').oninput=async()=>{
  const run=W.A.run;if(!run)return;
  const r=+$('scrub').value;
  W.scrubbing=r<run.round;
  $('liveBtn').style.display=W.scrubbing?'inline-flex':'none';
  $('scrubLab').textContent=`round ${r} / ${run.round}${W.scrubbing?' · replay':''}`;
  if(W.scrubbing){
    const key=run._id+':'+r;
    if(!W.roundCache[key])W.roundCache[key]=await client.query(api.serve.roundStances,{runId:H.runId,round:r});
    if(W.A.run&&W.A.run._id===run._id)W.scrubStances=W.roundCache[key]; // run switched mid-flight → drop
  }
};
$('liveBtn').onclick=()=>{W.scrubbing=false;$('liveBtn').style.display='none';
  if(W.A.run){$('scrub').value=W.A.run.round;$('scrubLab').textContent=`round ${W.A.run.round} / ${W.A.run.round}`}};

/* persona popover → server drill-down with real-post provenance */
async function cNodeHit(e,cv,adapter,runId){
  if(!adapter||!adapter.count)return;
  if(mapView(cv).dragged)return;   // a pan, not a click
  const r=cv.getBoundingClientRect(),dpr=devicePixelRatio;
  const mx=(e.clientX-r.left)*dpr,my=(e.clientY-r.top)*dpr;
  let best=-1,bd=1e9;
  for(let i=0;i<adapter.count;i++){
    const p=adapter.pos[i];if(!p||p.sy==null)continue;
    const d2=(p.x-mx)**2+(p.sy-my)**2;
    if(d2<bd){bd=d2;best=i}
  }
  if(best<0||bd>(22*dpr)**2){$('pop').style.display='none';return}
  const info=await client.query(api.serve.persona,{runId,idx:best});
  if(!info)return;
  const hist=info.hist,spark=hist.map((v,i)=>`${(i/Math.max(1,hist.length-1))*100},${(1-(v+1)/2)*30+2}`).join(' ');
  const s=hist[hist.length-1]??0;
  const pop=$('pop');
  const safeUrl=info.seedPost&&/^https?:\/\//i.test(info.seedPost.url||'')?info.seedPost.url:null;
  pop.innerHTML=`<div class="who"><b>${esc(info.name)}</b>
      <span class="stance-chip" style="color:${stanceColor(s)}">${s>=0?'+':''}${s.toFixed(2)}</span></div>
    <span class="chip">${esc(info.cohort)}</span> ${info.inf>1.4?'<span class="chip">⭑ influencer</span>':''}
    ${info.seedPost?`<div class="quote">“${esc(info.seedPost.text)}”</div>
      <div style="font-size:10px;color:var(--ink-3)">grown from a real ${esc(info.seedPost.platform)} post by @${esc(info.seedPost.author)}
      ${safeUrl?` · <a href="${esc(safeUrl)}" target="_blank" style="color:var(--sup)">source ↗</a>`:''}</div>`
      :'<div class="quote" style="color:var(--ink-3)">synthetic persona (no seed post)</div>'}
    ${(()=>{const ad=adapter,nbrs=(ad.adj[best]||[]);
      if(!W.revAdj){W.revAdj={};ad.adj.forEach((ns,i)=>ns.forEach(j=>{(W.revAdj[j]=W.revAdj[j]||[]).push(i)}))}
      const infl=nbrs.slice().sort((a,b)=>(ad.meta.inf[b]||0)-(ad.meta.inf[a]||0)).slice(0,3)
        .map(j=>esc(ad.meta.names[j])).join(', ');
      const reach=(W.revAdj[best]||[]).length;
      return `<div style="font-size:11px;color:var(--ink-3);margin-top:6px">influenced by: <span style="color:var(--ink-2)">${infl||'—'}</span> · reaches ${reach} persona${reach===1?'':'s'}</div>`})()}
    <div style="font-size:10px;letter-spacing:.1em;color:var(--ink-3);font-weight:700;margin-top:6px">STANCE · R0 → R${hist.length-1}</div>
    <svg viewBox="0 0 100 34" preserveAspectRatio="none">
      <line x1="0" y1="17" x2="100" y2="17" stroke="var(--baseline)" stroke-width=".5"/>
      <polyline points="${spark}" fill="none" stroke="${stanceColor(s)}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  pop.style.display='block';
  pop.style.left=Math.min(innerWidth-262,e.clientX+14)+'px';
  pop.style.top=Math.min(innerHeight-230,e.clientY-20)+'px';
}
cvA.addEventListener('click',e=>{if(W.A.run)cNodeHit(e,cvA,W.A,H.runId)});
cvB.addEventListener('click',e=>{if(W.B&&W.B.run)cNodeHit(e,cvB,W.B,H.forkId)});

/* convex-era frame loop: reuse drawMap with adapters + scrub cache */
(function cRaf(){
  try{
    if($('room').classList.contains('active')&&W.A.run){
      cDrawMap(cvA,W.A,W.scrubbing?W.scrubStances:null);
      if(W.B&&W.B.run)cDrawMap(cvB,W.B,null);
      if(!W.scrubbing)cRenderTally();
    }
  }catch(e){console.error('frame error (loop survives):',e)}
  requestAnimationFrame(cRaf);   // schedule OUTSIDE try — one bad frame can't kill the loop
})();
Object.assign(window,{W,enterWarRoom});

/* neutralize legacy local-engine paths (deleted for good in cleanup task) */
// space bar = start the engine (was the legacy setRunning shim)
window.addEventListener('keydown',e=>{
  if(e.code==='Space'&&$('room').classList.contains('active')&&!e.target.closest('input,textarea')
     &&W.A.run&&W.A.run.status==='ready'){e.preventDefault();client.mutation(api.sim.start,{runId:H.runId}).catch(console.error)}
});
$('verdictBtn').onclick=()=>cToast('Verdict — landing in the next build step.');

/* verdict on convex — approval, risk, ranked counterfactual flips */
let estimatesUnsub=null;var confUnsub=null;
$('verdictBtn').onclick=async()=>{
  const run=W.A.run;if(!run)return;
  const t=W.A.tally();if(!t.n)return;
  const amds=(H.decision&&H.decision.amendments&&H.decision.amendments.length?H.decision.amendments:DECISIONS[S.decisionIdx].amendments);
  // fire estimates only if this run has none yet (each open otherwise respawns 4 runs)
  const existing=await client.query(api.serve.estimates,{runId:H.runId}).catch(()=>null);
  const conf0=await client.query(api.mcpaths.get,{runId:H.runId}).catch(()=>null);
  if(!conf0)client.action(api.mcpaths.simulate,{runId:H.runId,samples:40}).catch(console.error);
  if(!existing)client.mutation(api.sim.estimate,{runId:H.runId,
    amendments:['grandfather','soften','compensate'].slice(0,amds.length)
      .map((m,i)=>({label:amds[i].label,mode:m}))}).catch(console.error);
  const st=await client.query(api.serve.liveState,{runId:H.runId});
  // biggest risk: most-negative-mean cohort, prefer one with hurt text
  // (cohortIdx lives in personaMeta since the payload slimming — regression fix)
  const cidx=(W.A.meta&&W.A.meta.cohortIdx)||[];
  const sums={},counts={};
  st.stances.forEach((s,i)=>{const c=cidx[i]??0;sums[c]=(sums[c]||0)+s;counts[c]=(counts[c]||0)+1});
  const rows=st.cohorts.map(c=>({...c,mean:(sums[c.idx]||0)/(counts[c.idx]||1)})).sort((a,b)=>a.mean-b.mean);
  const risk=rows.find(r=>r.hurt)||rows[0];
  const pctv=x=>Math.round(x/t.n*100);
  let forkHtml='';
  if(W.B&&W.B.run){const ta=W.B.tally();
    if(ta.n)forkHtml=`<div class="vh"><div class="k">Amended fork</div>
      <div class="v" style="color:var(--sup)">${Math.round(ta.sup/ta.n*100)}%</div>
      <div class="d">approval · “${S.forkLabel}” · Δ ${Math.round(ta.sup/ta.n*100)-pctv(t.sup)>=0?'+':''}${Math.round(ta.sup/ta.n*100)-pctv(t.sup)} pts</div></div>`}
  $('verdictBody').innerHTML=`
    <h2>Verdict · round ${run.round}</h2>
    <div class="sub">${esc((H.decision||DECISIONS[S.decisionIdx]).title)} — population of ${run.n} grown from real social posts</div>
    <div class="verdict-hero">
      <div class="vh"><div class="k">Predicted approval</div>
        <div class="v" style="color:var(--sup)">${pctv(t.sup)}%</div>
        <div class="d">${t.sup} of ${t.n} personas support</div>
        <div class="d" id="confBand" style="color:var(--ink-2)">confidence band: running replays…</div></div>
      <div class="vh"><div class="k">Opposition</div>
        <div class="v" style="color:var(--opp)">${pctv(t.opp)}%</div>
        <div class="d">${W.A.factions.filter(f=>f.side==='opp').length||'no'} organized opposing faction(s)</div></div>
      ${forkHtml}
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:2px 0 6px">
      Monte Carlo · <span id="fanMeta">simulating alternate futures…</span></div>
    <canvas id="mcFan" style="width:100%;height:170px;border:1px solid var(--ring);border-radius:10px;background:var(--surface-2);margin-bottom:14px"></canvas>
    <div class="risk"><span class="tag">BIGGEST RISK</span><br>
      <b>${esc(risk.name)}</b> — mean stance ${risk.mean.toFixed(2)}.
      ${esc(risk.hurt||'The most opposed cohort in the population.')}
      ${H.decision&&H.decision.skew?`<div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(208,59,59,.4)"><span class="tag">CORPUS SKEW</span><br>${esc(H.decision.skew)}</div>`:''}</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px">
      Amendments · counterfactual flips (4 silent futures simulating…)</div>
    <div id="estimateRows"><div class="ev sys">running counterfactual timelines…</div></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:14px 0 8px">
      Model council · each model predicts the outcome blind</div>
    <div id="councilRows"><div class="ev sys">convening the council…</div></div>
    <div class="foot">
      <button class="btn" id="exportCardBtn">📤 Export card</button>
      <button class="btn" id="calibrateBtn">🎯 Calibrate vs reality</button>
      <button class="btn primary" data-close>Close</button></div>`;
  $('verdictModal').classList.add('open');
  renderCouncil();
  document.getElementById('calibrateBtn').onclick=async()=>{
    const v=prompt('Real-world outcome — what % actually supported this decision?');
    if(v===null)return;
    const pct=parseFloat(v);
    if(!Number.isFinite(pct)){cToast('enter a number 0–100');return}
    await client.mutation(api.ops.calibrate,{runId:H.runId,
      label:(H.decision||DECISIONS[S.decisionIdx]).title,actualPct:pct}).catch(console.error);
    document.getElementById('calibrateBtn').textContent='🎯 Calibrated ✓ (see dashboard)';
  };
  document.getElementById('exportCardBtn').onclick=()=>exportVerdictCard(t,run);
  if(confUnsub)confUnsub();
  confUnsub=client.onUpdate(api.mcpaths.get,{runId:H.runId},cf=>{
    const elb=document.getElementById('confBand');
    if(elb&&cf)elb.textContent=`across ${cf.samples} simulated futures: ${cf.lo}–${cf.hi}% (p10–p90 ${cf.p10}–${cf.p90}%)`;
    if(cf)drawFan(cf);
    const fm=document.getElementById('fanMeta');
    if(fm&&cf)fm.textContent=`${cf.samples} full replays, distinct noise seeds · mean ${cf.mean}%`;
  });
  if(estimatesUnsub)estimatesUnsub();
  estimatesUnsub=client.onUpdate(api.serve.estimates,{runId:H.runId},est=>{
    const box=document.getElementById('estimateRows');if(!box||!est)return;
    box.innerHTML=est.rows.map((r,i)=>`<div class="amend" style="cursor:default">
      <div><b>${i+1}. ${esc(r.label)}</b></div>
      <span class="fx"><b>${r.done?`≈${r.flips} flipped`:'…'}</b>${r.done?'projected':'simulating'}</span></div>`).join('')
      +(est.allDone?'':'<div style="font-size:11px;color:var(--ink-3);padding:4px 2px">silent scheduler runs — same durable engine, no voices</div>');
  });
};


/* hash routing: #run=<id> mirrors a live run from any browser — convex reactivity IS the sync */
(function(){
  const m=location.hash.match(/run=([a-z0-9]+)/);
  if(m)enterWarRoom(m[1]);
})();

/* ═══════════════ INTERACTIVE OPINION SPACE (zoom · pan · hover) ═══════════════
   World coords = stance-x / cohort-band-y in device px. screen = world*zoom+pan.
   Edges render to an offscreen layer only when the round (or view size) changes;
   only the hovered node's edges stroke live. */
const mapViews=new Map();
function mapView(cv){
  let v=mapViews.get(cv);
  if(!v){v={zoom:1,panX:0,panY:0,hover:-1,drag:null,dragged:false,edgeCv:null,edgeKey:''};
    mapViews.set(cv,v);bindMap(cv,v)}
  return v;
}
const wxOf=(s,Wp)=>Wp/2+s*Wp*.4;
const wyOf=(pos,Hp)=>Hp*.06+pos.y*Hp*.78;

function cDrawMap(cv,adapter,viewStances){
  if(!adapter.meta||!adapter.count)return;
  const view=mapView(cv),ctx=cv.getContext('2d');
  const Wp=cv.width,Hp=cv.height,dpr=devicePixelRatio;
  if(!Wp)return;
  const st=viewStances||adapter.stances();
  if(!st.length)return;
  const now=performance.now();

  // ── cached edge layer (world coords, per-round) ──
  const key=`${Wp}x${Hp}:${adapter.round}:${viewStances?'scrub'+$('scrub').value:'live'}`;
  if(view.edgeKey!==key||adapter.edgesDirty){
    view.edgeKey=key;adapter.edgesDirty=false;
    if(!view.edgeCv)view.edgeCv=document.createElement('canvas');
    view.edgeCv.width=Wp;view.edgeCv.height=Hp;
    const e=view.edgeCv.getContext('2d');
    e.lineWidth=Math.max(1,.6*dpr);
    for(let i=0;i<adapter.count;i++){
      const nb=adapter.adj[i];if(!nb)continue;
      const x1=wxOf(st[i],Wp),y1=wyOf(adapter.pos[i],Hp);
      for(const j of nb){
        if(j<i||j>=adapter.count)continue;
        const agree=1-Math.abs(st[i]-st[j])/2;
        e.strokeStyle=`rgba(200,200,200,${(.02+agree*.03).toFixed(3)})`;
        e.beginPath();e.moveTo(x1,y1);e.lineTo(wxOf(st[j],Wp),wyOf(adapter.pos[j],Hp));e.stroke();
      }
    }
  }

  ctx.clearRect(0,0,Wp,Hp);
  ctx.save();
  ctx.setTransform(view.zoom,0,0,view.zoom,view.panX,view.panY);
  ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;
  ctx.setLineDash([4*dpr,6*dpr]);
  ctx.beginPath();ctx.moveTo(Wp/2,Hp*.03);ctx.lineTo(Wp/2,Hp*.9);ctx.stroke();
  ctx.setLineDash([]);
  if(view.edgeCv)ctx.drawImage(view.edgeCv,0,0);
  ctx.restore();

  // ── nodes (screen space; positions stored for hit-testing) ──
  const rScale=Math.sqrt(view.zoom);
  for(let i=0;i<adapter.count;i++){
    const p=adapter.personas[i],pos=adapter.pos[i];
    const twx=wxOf(st[i],Wp);
    pos.wx=pos.wx?pos.wx+(twx-pos.wx)*.12:twx;      // responsive, not floaty
    const wy=wyOf(pos,Hp)+Math.cos(now/2300+pos.jit)*1.4*dpr;
    const sx=pos.wx*view.zoom+view.panX,sy=wy*view.zoom+view.panY;
    if(sx<-24||sx>Wp+24||sy<-24||sy>Hp+24){pos.x=-1e4;pos.sy=-1e4;continue}  // cull
    const born=adapter.bornAt?Math.max(0,Math.min(1,(now-adapter.bornAt-i*0.35)/320)):1;
    if(born===0){pos.x=-1e4;pos.sy=-1e4;continue}
    const r=(2.2+p.inf*2.4)*dpr*rScale*(adapter.sizeK||1)*born;
    if(Math.abs(st[i])>.6){
      ctx.fillStyle=stanceColor(st[i],.16);
      ctx.beginPath();ctx.arc(sx,sy,r*2,0,7);ctx.fill();
    }
    ctx.fillStyle=stanceColor(st[i],.95);
    ctx.beginPath();ctx.arc(sx,sy,r,0,7);ctx.fill();
    if(p.inf>1.4){ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1*dpr;
      ctx.beginPath();ctx.arc(sx,sy,r+2*dpr,0,7);ctx.stroke()}
    pos.x=sx;pos.sy=sy;pos.sr=r;
  }

  // ── hover: node ring + its live edges ──
  const h=view.hover;
  if(h>=0&&h<adapter.count&&adapter.pos[h].x>-1e3){
    const hp=adapter.pos[h];
    ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=Math.max(1,.9*dpr);
    for(const j of adapter.adj[h]||[]){
      if(j>=adapter.count)continue;
      const jx=wxOf(st[j],Wp)*view.zoom+view.panX;
      const jy=wyOf(adapter.pos[j],Hp)*view.zoom+view.panY;
      ctx.beginPath();ctx.moveTo(hp.x,hp.sy);ctx.lineTo(jx,jy);ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.6)';
      ctx.beginPath();ctx.arc(jx,jy,2.2*dpr,0,7);ctx.fill();
    }
    ctx.strokeStyle='#fff';ctx.lineWidth=1.4*dpr;
    ctx.beginPath();ctx.arc(hp.x,hp.sy,hp.sr+3*dpr,0,7);ctx.stroke();
  }
}

function adapterFor(cv){return cv===cvA?W.A:W.B}
function bindMap(cv,view){
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const dpr=devicePixelRatio,r=cv.getBoundingClientRect();
    const mx=(e.clientX-r.left)*dpr,my=(e.clientY-r.top)*dpr;
    const nz=Math.min(4,Math.max(.5,view.zoom*Math.exp(-e.deltaY*.0012)));
    view.panX=mx-(mx-view.panX)*(nz/view.zoom);
    view.panY=my-(my-view.panY)*(nz/view.zoom);
    view.zoom=nz;
  },{passive:false});
  cv.addEventListener('mousedown',e=>{
    view.drag={x:e.clientX,y:e.clientY,panX:view.panX,panY:view.panY};
    cv.classList.add('dragging');
  });
  cv.addEventListener('mousemove',e=>{
    const dpr=devicePixelRatio;
    if(view.drag){
      const dx=(e.clientX-view.drag.x)*dpr,dy=(e.clientY-view.drag.y)*dpr;
      if(Math.abs(dx)+Math.abs(dy)>6)view.dragged=true;
      view.panX=view.drag.panX+dx;view.panY=view.drag.panY+dy;
      return;
    }
    const ad=adapterFor(cv);if(!ad||!ad.count)return;
    const r=cv.getBoundingClientRect();
    const mx=(e.clientX-r.left)*dpr,my=(e.clientY-r.top)*dpr;
    let best=-1,bd=(16*dpr)**2;
    for(let i=0;i<ad.count;i++){
      const p=ad.pos[i];if(p.x<-1e3)continue;
      const d2=(p.x-mx)**2+(p.sy-my)**2;
      if(d2<bd){bd=d2;best=i}
    }
    view.hover=best;
    cv.style.cursor=best>=0?'pointer':'';
    const chip=$('hoverChip');
    if(best>=0&&ad.meta){
      const cName=(ad.d.cohorts[ad.meta.cohortIdx[best]]||{}).name||'—';
      chip.innerHTML=`<b>${esc(ad.meta.names[best])}</b><span class="chip">${esc(cName)}</span>`;
      chip.style.display='block';
      chip.style.left=(e.clientX+14)+'px';
      chip.style.top=(e.clientY-30)+'px';
    }else chip.style.display='none';
  });
  const endDrag=()=>{view.drag=null;cv.classList.remove('dragging');
    requestAnimationFrame(()=>{view.dragged=false})};
  cv.addEventListener('mouseup',endDrag);
  cv.addEventListener('mouseleave',()=>{endDrag();view.hover=-1;$('hoverChip').style.display='none'});
  cv.addEventListener('dblclick',()=>{view.zoom=1;view.panX=0;view.panY=0});
}

/* factions strip now reads adapters, not the retired local sims */
const renderFactions=function(){
  const put=(box,ad,runId)=>{
    box.innerHTML='';
    (ad?ad.factions:[]).forEach(f=>{
      const c=el('div','faction',`<b>${esc(f.name)}</b>${f.n} personas · “${esc(f.arg)}” · <span style="color:var(--sup)">dive ↗</span>`);
      c.style.borderLeftColor=f.side==='opp'?'var(--opp)':'var(--sup)';
      c.style.cursor='pointer';
      if(f.ci!==undefined)c.onclick=()=>cohortDive(runId,f.ci);
      box.append(c);
    });
  };
  put($('factionsA'),W.A,H.runId);put($('factionsB'),W.B,H.forkId);
};

/* zoom/pan/hover affordance hint on the map cards */
document.querySelectorAll('.map-card').forEach(mc=>{
  mc.insertAdjacentHTML('beforeend','<span class="map-hint">SCROLL ZOOM · DRAG PAN · CLICK PERSONA</span>');
});
Object.assign(window,{mapView,cDrawMap});

/* untrusted-content escaping (scraped posts, LLM output) */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* hash router: #run=<id> is the one deep-linkable state; Back/paste/edit all work */
window.addEventListener('hashchange',()=>{
  const m=location.hash.match(/run=([a-z0-9]+)/);
  if(m&&m[1]!==H.runId)enterWarRoom(m[1]);
  else if(!m&&$('room').classList.contains('active')){unsubAll();showView('setup')}
});

/* ═══ landing dashboard: live workspace KPIs + recent runs + source health ═══ */
client.onUpdate(api.ops.workspaceStats,{},st=>{
  $('dash').style.display='grid';
  $('kPosts').textContent=st.posts;
  $('kRuns').textContent=st.runs;
  $('kRunsD').textContent=`${st.completeRuns} complete${st.silentRuns?` · ${st.silentRuns} silent`:''}`;
  $('kDecisions').textContent=st.decisions;
  const box=$('srcHealth');
  if(st.sources.length){
    const max=Math.max(...st.sources.map(s2=>s2.count),1);
    box.innerHTML='';
    st.sources.slice(0,6).forEach(s2=>{
      box.append(el('div','srch-row',
        `<span style="width:74px">${esc(s2.platform)}</span>
         <span class="bar"><i style="width:${Math.round(s2.count/max*100)}%"></i></span>
         <span style="min-width:34px;text-align:right;font-variant-numeric:tabular-nums">${s2.count}</span>
         <span class="chip" style="color:${s2.status==='failed'?'#f0a0a0':'var(--good)'}">${esc(s2.status)}</span>`));
    });
  }
});
client.onUpdate(api.ops.recentRuns,{},runs=>{
  const box=$('runRows');if(!runs.length)return;
  box.innerHTML='';
  runs.forEach(r=>{
    const row=el('div','run-row',
      `<span class="t"><b>${r.forked?'⑂ ':''}${esc(r.label==='baseline'?r.title:r.label)}</b>${esc(r.title)}</span>
       <span class="chip">${r.n}p</span>
       <span class="chip" style="color:${r.status==='running'?'var(--good)':'var(--ink-2)'}">${r.status==='running'?'● live':esc(r.status)} · R${r.round}/${r.rounds}</span>
       <button class="btn" data-open="${r._id}">Open</button>`);
    row.querySelector('[data-open]').onclick=()=>enterWarRoom(r._id);
    box.append(row);
  });
});
client.action(api.ingest.llmInfo,{}).then(s2=>{
  $('kLlm').textContent=s2.local?`local · ${s2.localModel}`:s2.gemini?'gemini flash':'deterministic';
  $('kLlmD').textContent=s2.local?'ollama endpoint':s2.gemini?'cloud API':'seed-quote fallback';
}).catch(()=>{});
$('cleanupBtn').onclick=async e=>{
  e.stopPropagation();
  $('cleanupBtn').disabled=true;
  try{const r=await client.mutation(api.ops.cleanup,{});
    $('cleanupBtn').textContent=r.rescheduled?'🧹 cleaning…':'🧹 cleaned ✓';
  }catch(err){console.error(err)}
  setTimeout(()=>{$('cleanupBtn').textContent='🧹 Clean workspace';$('cleanupBtn').disabled=false},3000);
};

/* ═══ settings page ═══ */
document.querySelectorAll('[data-settings]').forEach(b=>{b.onclick=()=>openSettings()});
$('settingsBack').onclick=()=>showView('setup');
async function openSettings(){
  showView('settings');
  const st=await client.query(api.settings.get,{}).catch(()=>null);
  if(st){
    $('savedGemini').textContent=st.geminiKey||'';
    $('savedHf').textContent=st.hfToken||'';
    $('setLocalUrl').value=st.localUrl||'';
    $('setLocalModel').value=st.localModel||'';
    $('setHfModel').value=st.hfModel||'';
    $('setRounds').value=st.rounds;$('roundsOut').textContent=st.rounds;
    $('setTick').value=st.tickMs;$('tickOut').textContent=st.tickMs;
    $('setCouncil').checked=!!st.council;
  }
  refreshTiers();
}
function refreshTiers(){
  client.action(api.ingest.llmInfo,{}).then(info=>{
    const box=$('tierChips');box.innerHTML='';
    if(!info.tiers.length){box.innerHTML='<span class="chip">deterministic fallback only</span>';return}
    info.tiers.forEach(t=>box.append(el('span','chip',`● ${esc(t.label)}`)));
    const k=$('kLlm');if(k){k.textContent=info.tiers[0].label;$('kLlmD').textContent=info.tiers.length>1?`+${info.tiers.length-1} more tier(s)`:'voices layer'}
  }).catch(()=>{});
}
$('setRounds').oninput=e=>$('roundsOut').textContent=e.target.value;
$('setTick').oninput=e=>$('tickOut').textContent=e.target.value;
$('settingsSave').onclick=async()=>{
  $('settingsSave').disabled=true;
  try{
    await client.mutation(api.settings.save,{
      geminiKey:$('setGemini').value.trim()||undefined,
      localUrl:$('setLocalUrl').value.trim(),
      localModel:$('setLocalModel').value.trim(),
      hfToken:$('setHf').value.trim()||undefined,
      hfModel:$('setHfModel').value.trim(),
      rounds:+$('setRounds').value,tickMs:+$('setTick').value,
      council:$('setCouncil').checked});
    $('setGemini').value='';$('setHf').value='';
    $('settingsMsg').textContent='saved ✓ — applies to the next network build';
    openSettings();
  }catch(e){$('settingsMsg').textContent='save failed: '+e.message}
  finally{$('settingsSave').disabled=false;setTimeout(()=>$('settingsMsg').textContent='',4000)}
};

/* ═══ source tabs on the corpus ticker ═══ */
var tickerPlat=null,tickerUnsub=null; // var: assigned earlier in module eval (T3 ticker sub)
const TICKER_TABS=[null,'reddit','lemmy','hn','bluesky','mastodon','x'];
(function buildTabs(){
  const bar=$('tickerTabs');if(!bar)return;
  TICKER_TABS.forEach(p=>{
    const b=el('button',p===null?'on':'',p===null?'all':p);
    b.onclick=()=>{
      tickerPlat=p;
      [...bar.children].forEach(c=>c.classList.toggle('on',c===b));
      if(tickerUnsub)tickerUnsub();
      tickerUnsub=client.onUpdate(api.ingest.recentPosts,
        p?{limit:30,platform:p}:{limit:30},renderTickerPosts);
    };
    bar.append(b);
  });
})();
function renderTickerPosts(posts){
  const t=$('postTicker');if(!t)return;t.innerHTML='';
  if(!posts.length){t.innerHTML='<div style="padding:8px 12px;font-size:12px;color:var(--ink-3)">no posts from this source yet</div>';return}
  posts.forEach(p=>{
    t.append(el('div','tick-post',
      `<div class="who"><b>@${esc(p.author)}</b><span class="chip">${esc(p.platform)}</span>▲ ${p.score}</div>${esc(p.text)}`));
  });
}

/* ═══ model council card inside the verdict ═══ */
async function renderCouncil(){
  const box=document.getElementById('councilRows');if(!box)return;
  const res=await client.action(api.council.run,{runId:H.runId}).catch(e=>({error:e.message}));
  if(!box.isConnected)return;
  if(res.error){box.innerHTML=`<div class="ev sys">${esc(res.error)}</div>`;return}
  if(!res.rows||!res.rows.length){
    box.innerHTML=`<div class="ev sys">${esc(res.note||'no model predictions — configure models in ⚙ Settings')}</div>`;return}
  box.innerHTML=(res.consensus!==null?`<div style="font-size:12px;color:var(--ink-2);margin-bottom:8px">council consensus <b>${res.consensus}%</b> vs engine <b>${res.actual}%</b></div>`:'')
    +res.rows.map(r=>`<div class="council-row">
      <div><b>${esc(r.model)}</b><div style="color:var(--ink-3);font-size:11px;margin-top:2px">${esc(r.reason)}</div></div>
      <span class="chip">predicted ${r.prediction}%</span>
      <span class="acc" style="color:${r.accuracy>=90?'var(--good)':r.accuracy>=75?'var(--warning)':'var(--opp)'}">${r.accuracy}%</span>
    </div>`).join('')
    +(res.skipped&&res.skipped.length?`<div style="font-size:11px;color:var(--ink-3)">no valid answer: ${esc(res.skipped.join(', '))}</div>`:'');
}


/* calibration scorecard on the dashboard */
client.onUpdate(api.ops.calibrations,{},rows=>{
  let card=document.getElementById('calCard');
  if(!rows.length){if(card)card.remove();return}
  if(!card){
    card=el('div','card runs-card');card.id='calCard';
    card.innerHTML='<div class="card-h">Calibration · predicted vs reality</div><div id="calRows"></div>';
    $('dash').append(card);
  }
  const box=document.getElementById('calRows');box.innerHTML='';
  rows.forEach(r=>{
    const grade=r.error<=5?'A':r.error<=10?'B':r.error<=20?'C':'D';
    box.append(el('div','run-row',
      `<span class="t"><b>${esc(r.label)}</b>predicted ${r.predictedPct}% · actual ${r.actualPct}%</span>
       <span class="chip">±${r.error} pts</span>
       <span class="acc" style="font-weight:800;color:${r.error<=10?'var(--good)':r.error<=20?'var(--warning)':'var(--opp)'}">${grade}</span>
       <span></span>`));
  });
});

/* ═══ presence: who's watching + live cursors (hand-rolled heartbeat) ═══ */
const CLIENT_ID=sessionStorage.aid||(sessionStorage.aid=Math.random().toString(36).slice(2,10));
const WATCH_NAME='watcher-'+CLIENT_ID.slice(0,4);
let presenceTimer=null,myCursor={x:.5,y:.5},viewersUnsub=null;
function startPresence(runId){
  stopPresence();
  const beat=()=>client.mutation(api.presence.heartbeat,
    {runId,clientId:CLIENT_ID,name:WATCH_NAME,x:myCursor.x,y:myCursor.y}).catch(()=>{});
  beat();presenceTimer=setInterval(beat,8000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)beat()});
  viewersUnsub=client.onUpdate(api.presence.viewers,{runId},vs=>{
    const others=vs.filter(v2=>v2.clientId!==CLIENT_ID);
    let chip=document.getElementById('watchChip');
    if(!chip){chip=el('span','pill');chip.id='watchChip';
      $('statusPill').after(chip)}
    chip.innerHTML=`👁 ${vs.length} watching`;
    let layer=document.getElementById('cursorLayer');
    if(!layer){layer=el('div','');layer.id='cursorLayer';
      layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:5';
      document.getElementById('mapCardA').append(layer)}
    layer.innerHTML='';
    const r=cvA.getBoundingClientRect();
    others.forEach(v2=>{
      const d=el('div','',`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--warning)"></span> <span style="font-size:10px;color:var(--ink-2)">${esc(v2.name)}</span>`);
      d.style.cssText=`position:absolute;left:${v2.x*100}%;top:${v2.y*100}%;transform:translate(-4px,-4px);transition:left .8s,top .8s`;
      layer.append(d);
    });
  });
}
function stopPresence(){
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null}
  if(viewersUnsub){try{viewersUnsub()}catch(e){}viewersUnsub=null}
  document.getElementById('watchChip')?.remove();
  document.getElementById('cursorLayer')?.remove();
}
cvA.addEventListener('mousemove',e=>{
  const r=cvA.getBoundingClientRect();
  myCursor={x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),
            y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};
});

/* ═══ cohort deep-dive modal (reuses verdict modal shell) ═══ */
async function cohortDive(runId,ci){
  const d=await client.query(api.serve.cohortDive,{runId,ci}).catch(()=>null);
  if(!d)return;
  const arrow=d.meanN>d.mean0+.02?'→ warming':d.meanN<d.mean0-.02?'→ hardening':'→ holding';
  $('verdictBody').innerHTML=`
    <h2>${esc(d.name)}</h2>
    <div class="sub">${d.n} personas · ${Math.round(d.share*100)}% of population · tags: ${d.tags.map(esc).join(', ')}</div>
    <div class="verdict-hero">
      <div class="vh"><div class="k">Round 0 stance</div><div class="v" style="color:${stanceColor(d.mean0)}">${d.mean0.toFixed(2)}</div></div>
      <div class="vh"><div class="k">Now</div><div class="v" style="color:${stanceColor(d.meanN)}">${d.meanN.toFixed(2)}</div><div class="d">${arrow}</div></div>
    </div>
    ${d.hurt?`<div class="risk"><span class="tag">STRUCTURAL RISK</span><br>${esc(d.hurt)}</div>`:''}
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px">Grown from these real posts</div>
    ${d.posts.map(p=>`<div class="ev" style="margin-bottom:8px"><div class="who"><b>@${esc(p.author)}</b><span class="chip">${esc(p.platform)}</span></div>“${esc(p.text)}”</div>`).join('')||'<div class="ev sys">no linked posts</div>'}
    <div class="foot"><button class="btn primary" data-close>Close</button></div>`;
  $('verdictModal').classList.add('open');
}
Object.assign(window,{cohortDive});

/* ═══ shareable verdict card (canvas → PNG download, zero deps) ═══ */
function exportVerdictCard(t,run){
  const cv=document.createElement('canvas');cv.width=1000;cv.height=560;
  const x=cv.getContext('2d'),pct=n=>Math.round(n/t.n*100);
  x.fillStyle='#0d0d0d';x.fillRect(0,0,1000,560);
  x.fillStyle='#3987e5';x.fillRect(0,0,1000,6);
  x.fillStyle='#fff';x.font='700 22px system-ui';x.fillText('AGORA · CONSEQUENCE VERDICT',40,60);
  x.fillStyle='#c3c2b7';x.font='16px system-ui';
  const title=(H.decision||DECISIONS[S.decisionIdx]).title;
  x.fillText(title.slice(0,80),40,95);
  x.font='12px system-ui';x.fillStyle='#898781';
  x.fillText(`${run.n} personas grown from real social posts · ${run.rounds} rounds · round ${run.round}`,40,120);
  const bands=[['SUPPORT',t.sup,'#3987e5'],['NEUTRAL',t.neu,'#55544e'],['OPPOSE',t.opp,'#e66767']];
  let bx=40;
  bands.forEach(([lab,n,col])=>{
    const w=(n/t.n)*920;
    x.fillStyle=col;x.fillRect(bx,160,Math.max(2,w-4),46);
    bx+=w;
  });
  bx=40;
  bands.forEach(([lab,n,col])=>{
    const w=(n/t.n)*920;
    x.fillStyle='#fff';x.font='700 15px system-ui';
    if(w>90)x.fillText(`${lab} ${pct(n)}%`,bx+10,189);
    bx+=w;
  });
  const conf=document.getElementById('confBand')?.textContent||'';
  x.fillStyle='#c3c2b7';x.font='14px system-ui';x.fillText(conf,40,245);
  const risk=document.querySelector('#verdictBody .risk');
  if(risk){x.fillStyle='#f2a1a1';x.font='700 13px system-ui';x.fillText('BIGGEST RISK',40,295);
    x.fillStyle='#c3c2b7';x.font='14px system-ui';
    const words=risk.innerText.replace(/\n+/g,' ').replace('BIGGEST RISK','').trim().split(' ');
    let line='',ly=320;
    for(const w of words){if(x.measureText(line+' '+w).width>900){x.fillText(line,40,ly);ly+=22;line=w;if(ly>430)break}else line=line?line+' '+w:w}
    if(ly<=430)x.fillText(line,40,ly);}
  x.fillStyle='#898781';x.font='13px system-ui';
  x.fillText('replay live: '+location.origin+location.pathname+'#run='+run._id,40,505);
  x.fillStyle='#3987e5';x.fillText('github.com/ayushap18/agora · convex durable simulation',40,530);
  const a=document.createElement('a');
  a.download='agora-verdict.png';a.href=cv.toDataURL('image/png');a.click();
}

/* ═══ decision monitoring: toggle + drift chart ═══ */
(function(){
  const card=document.querySelector('#harness .side-col .card:last-child');
  const b=el('button','btn','🛰 Monitor daily');b.id='monitorBtn';
  card.insertBefore(b,card.querySelector('span'));
  b.onclick=async()=>{
    if(!H.decisionDocId){cToast('distill first');return}
    const q=document.querySelector('input[data-plat="hn"]')?.value.trim()||'';
    const cur=await client.query(api.serve.decision,{decisionId:H.decisionDocId});
    const on=!(cur&&cur.monitor);
    await client.mutation(api.monitor.setMonitor,{decisionId:H.decisionDocId,on,query:q||undefined});
    b.textContent=on?'🛰 Monitoring ✓ (daily 06:00 UTC)':'🛰 Monitor daily';
  };
})();
client.onUpdate(api.monitor.list,{},async ds=>{
  let card=document.getElementById('driftCard');
  if(!ds.length){if(card)card.remove();return}
  if(!card){card=el('div','card runs-card');card.id='driftCard';
    card.innerHTML='<div class="card-h">Decision monitoring · projected reception over time</div><div id="driftRows"></div>';
    $('dash').append(card)}
  const box=document.getElementById('driftRows');box.innerHTML='';
  for(const d of ds){
    const s2=await client.query(api.monitor.series,{decisionId:d._id}).catch(()=>[]);
    const pts=s2.map((p,i)=>`${8+(i/(Math.max(1,s2.length-1)))*140},${34-(p.pct/100)*28}`).join(' ');
    box.append(el('div','run-row',
      `<span class="t"><b>${esc(d.title)}</b>${s2.length} runs · latest ${s2.length?s2[s2.length-1].pct+'%':'—'}</span>
       <svg width="156" height="38" style="grid-column:span 2"><polyline points="${pts}" fill="none" stroke="var(--sup)" stroke-width="2"/>
         ${s2.map((p,i)=>`<circle cx="${8+(i/(Math.max(1,s2.length-1)))*140}" cy="${34-(p.pct/100)*28}" r="2.5" fill="var(--sup)"/>`).join('')}</svg>
       <span class="chip">daily 06:00</span>`));
  }
});

/* Monte Carlo fan chart: every path a full replay; color = where it lands */
function drawFan(cf){
  const cv=document.getElementById('mcFan');if(!cv||!cf||!cf.paths)return;
  const dpr=devicePixelRatio,rect=cv.getBoundingClientRect();
  cv.width=rect.width*dpr;cv.height=rect.height*dpr;
  const x=cv.getContext('2d'),W2=cv.width,H2=cv.height;
  const P=cf.paths,R2=P[0].length-1;
  let lo=Infinity,hi=-Infinity;
  P.forEach(p=>p.forEach(v2=>{if(v2<lo)lo=v2;if(v2>hi)hi=v2}));
  const pad=Math.max(2,(hi-lo)*.15);lo=Math.max(0,lo-pad);hi=Math.min(100,hi+pad);
  const padL=34*dpr,padR=10*dpr,padT=8*dpr,padB=18*dpr;
  const X=r=>padL+(r/R2)*(W2-padL-padR);
  const Y=v2=>padT+(1-(v2-lo)/(hi-lo))*(H2-padT-padB);
  x.clearRect(0,0,W2,H2);
  // grid + labels
  x.strokeStyle='rgba(255,255,255,.07)';x.fillStyle='#898781';
  x.font=`${10*dpr}px system-ui`;x.lineWidth=1;
  for(const gv of [lo,(lo+hi)/2,hi]){
    x.beginPath();x.moveTo(padL,Y(gv));x.lineTo(W2-padR,Y(gv));x.stroke();
    x.fillText(Math.round(gv)+'%',4*dpr,Y(gv)+3*dpr);
  }
  x.fillText('R0',padL,H2-4*dpr);x.fillText('R'+R2,W2-padR-16*dpr,H2-4*dpr);
  // p10–p90 envelope per round
  const perRound=r=>P.map(p=>p[r]).sort((a,b)=>a-b);
  const q=(arr,f)=>arr[Math.min(arr.length-1,Math.floor(arr.length*f))];
  x.beginPath();
  for(let r=0;r<=R2;r++){const v2=q(perRound(r),.9);r===0?x.moveTo(X(r),Y(v2)):x.lineTo(X(r),Y(v2))}
  for(let r=R2;r>=0;r--)x.lineTo(X(r),Y(q(perRound(r),.1)));
  x.closePath();x.fillStyle='rgba(57,135,229,.10)';x.fill();
  // paths, colored by final landing zone (diverging: blue=support, red=oppose)
  x.lineWidth=Math.max(1,.8*dpr);
  P.forEach(p=>{
    x.strokeStyle=stanceColor((p[p.length-1]-50)/50,.32);
    x.beginPath();
    p.forEach((v2,r)=>{r===0?x.moveTo(X(r),Y(v2)):x.lineTo(X(r),Y(v2))});
    x.stroke();
  });
  // median path
  x.strokeStyle='#fff';x.lineWidth=1.6*dpr;
  x.beginPath();
  for(let r=0;r<=R2;r++){const v2=q(perRound(r),.5);r===0?x.moveTo(X(r),Y(v2)):x.lineTo(X(r),Y(v2))}
  x.stroke();
}

/* ═══ FERRARI CHROME: nav links, theme switch, tachometer, hero CTAs ═══ */
// theme (persisted): dark cinema ↔ light editorial
(function theme(){
  const saved=localStorage.getItem('agora-theme');
  if(saved==='light')document.documentElement.dataset.theme='light';
})();
function toggleTheme(){
  const root=document.documentElement;
  const light=root.dataset.theme==='light';
  if(light){delete root.dataset.theme;localStorage.setItem('agora-theme','dark')}
  else{root.dataset.theme='light';localStorage.setItem('agora-theme','light')}
  document.querySelectorAll('.theme-toggle').forEach(b=>{b.textContent=root.dataset.theme==='light'?'◐':'◑'});
}
// nav: minimal on the landing (cinema stays clean); full strip on inner pages,
// current page marked, one Settings entry total.
const NAV=[['Home','setup',()=>{unsubAll();history.replaceState(null,'',location.pathname);showView('setup')}],
  ['Pit wall','pitwall',()=>showView('pitwall')],
  ['Harness','harness',()=>openHarness()],
  ['War room','room',()=>{if(H.runId)enterWarRoom(H.runId)}],
  ['Settings','settings',()=>openSettings()]];
(function navs(){
  document.querySelectorAll('#pitwall .topbar, #harness .topbar, #room .topbar, #settings .setup-nav').forEach(bar=>{
    const wrap=el('nav','nav-links');
    NAV.forEach(([label,view,go])=>{
      const a=el('a','',label);
      a.dataset.view=view;
      if(view==='room')a.dataset.gate='needs-run';
      a.onclick=e=>{e.preventDefault();go()};
      wrap.append(a);
    });
    const logo=bar.querySelector('.logo');
    logo?logo.after(wrap):bar.prepend(wrap);
  });
  document.querySelectorAll('#setup .setup-nav, #pitwall .topbar, #harness .topbar, #room .topbar, #settings .setup-nav').forEach(bar=>{
    const t=el('button','btn ghost theme-toggle','◑');
    t.title='theme';t.onclick=toggleTheme;
    bar.append(t);
  });
  if(document.documentElement.dataset.theme==='light')
    document.querySelectorAll('.theme-toggle').forEach(b=>b.textContent='◐');
  setInterval(()=>{
    document.querySelectorAll('[data-gate="needs-run"]').forEach(a=>a.classList.toggle('dis',!H.runId));
    const cur=document.querySelector('.view.active')?.id;
    document.querySelectorAll('.nav-links a').forEach(a=>a.classList.toggle('cur',a.dataset.view===cur));
  },800);
})();
// tachometer: sweep on load, redline pulse on hover of the primary CTA
(function tach(){
  const t=$('tach');if(!t)return;
  for(let i=0;i<36;i++)t.append(el('i',''));
  const ticks=[...t.children];
  let sweep=0;
  const iv=setInterval(()=>{
    if(sweep<ticks.length)ticks[sweep++].classList.add('lit');
    else{clearInterval(iv);
      setTimeout(()=>ticks.forEach((x,i)=>setTimeout(()=>x.classList.remove('lit'),i*12)),400);
      $('tachLabel').textContent='Engine warm · pick a decision below';}
  },28);
  $('heroStart').onclick=()=>{
    shudder(document.querySelector('.hero-cinema h1'));
    ticks.forEach((x,i)=>setTimeout(()=>x.classList.add('lit'),i*7));
    setTimeout(()=>ticks.forEach(x=>x.classList.remove('lit')),600);
    engineFilm(()=>showView('pitwall'));};
  $('heroRuns').onclick=()=>showView('pitwall');
})();
