import { client, api } from './convexClient.js';

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
  sub:'company-wide return-to-office policy · 1,900 employees',
  text:'Effective next quarter, all employees must work from the office 4 days per week. Remote-work exceptions are discontinued. Badge data will be reviewed monthly by people-ops.',
  beats:{2:{txt:'A widely-shared thread compares commute costs to a 6% pay cut.',shift:{'Parents & caregivers':-.1,'Tenured ICs':-.08}},
         5:{txt:'Leadership publishes office-utilization numbers defending the mandate.',shift:{'Managers':.08,'Ops & facilities':.08}},
         8:{txt:'Two senior engineers publicly announce they are interviewing elsewhere.',shift:{'Remote-hired engineers':-.1,'New grads':-.06}}},
  cohorts:[
   {name:'Remote-hired engineers',share:.21,base:-.72,vol:.9,inf:1.5,slot:5,hurt:'They joined under explicit remote contracts; the mandate rewrites their deal and their attrition risk is the highest in the population.',
    tags:['hired remote','attrition risk'],facOpp:'The Remote Guard',facSup:'Returners',
    q:{o:['I signed a remote contract. This rewrites it retroactively.','My whole team is in three time zones — the office adds nothing but commute.','If badge data becomes a performance signal, I\'m out.'],n:['I\'d consider anchor days if the team actually overlapped.','Waiting to see if exceptions survive review.'],s:['Honestly the whiteboard time has been good for the juniors.']}},
   {name:'Parents & caregivers',share:.17,base:-.58,vol:.8,inf:.7,slot:7,hurt:'School pickup at 3pm is physically incompatible with 4 badge days; they will comply on paper and quietly disengage — or leave without saying why.',
    tags:['childcare','commute burden'],facOpp:'Caregiver Coalition',facSup:'Flexible Returners',
    q:{o:['Four days means I miss every school pickup. That\'s not a preference, it\'s arithmetic.','Daycare near the office has an 11-month waitlist.','I\'ll comply and quietly start looking.'],n:['Two anchor days I could actually plan around.'],s:['The office childcare pilot changed my math completely.']}},
   {name:'New grads',share:.13,base:.18,vol:1.1,inf:.6,slot:2,hurt:null,
    tags:['mentorship','social fabric'],facOpp:'Reluctant Commuters',facSup:'Office Natives',
    q:{o:['My rent near the office eats the whole "culture" argument.'],n:['I like the office but four days feels arbitrary.','Depends who else actually shows up.'],s:['I learn 3× faster sitting next to my senior.','The office is where I actually met people this year.']}},
   {name:'Managers',share:.12,base:.44,vol:.6,inf:1.3,slot:1,hurt:null,
    tags:['coordination','visibility'],facOpp:'Skeptical Leads',facSup:'Culture Rebuilders',
    q:{o:['I manage output, not chairs. This makes my job harder, not easier.'],n:['I\'ll enforce whatever we pick — just pick one and stop relitigating it.'],s:['Cross-team friction dropped every time we were co-located.','Onboarding quality is visibly better in person.']}},
   {name:'Sales & GTM',share:.12,base:.3,vol:.7,inf:.9,slot:3,hurt:null,
    tags:['client energy','pipeline'],facOpp:'Road Warriors',facSup:'Floor Energy',
    q:{o:['I\'m at client sites 3 days a week — badge policy punishes my best weeks.'],n:['Fine either way, my quota doesn\'t care where I sit.'],s:['Deal reviews in a room close faster. It\'s real.']}},
   {name:'Ops & facilities',share:.08,base:.52,vol:.5,inf:.8,slot:4,hurt:null,
    tags:['utilization','budget'],facOpp:'Quiet Doubters',facSup:'Building Advocates',
    q:{o:['We cut two floors last year. Where exactly do 1,900 people sit?'],n:['Give me headcount-by-day and I can make it work.'],s:['An empty building is the most expensive thing we own.']}},
   {name:'Tenured ICs',share:.17,base:-.34,vol:.7,inf:1.2,slot:8,hurt:null,
    tags:['proven output','trust'],facOpp:'The Proven Remote',facSup:'Returning Veterans',
    q:{o:['Five years of top ratings from my home office. What signal did I miss?','This reads as distrust dressed up as culture.'],n:['I\'ll trade anchor days for the end of badge reports.'],s:['I miss the hallway problems. Some of my best work started there.']}}],
  amendments:[
   {label:'Grandfather remote-hired employees',detail:'anyone hired under a remote contract keeps it',
    fx:{'Remote-hired engineers':.95,'Tenured ICs':.25,'Parents & caregivers':.1}},
   {label:'Reduce to 2 anchor days',detail:'team-chosen anchor days, no badge reviews',
    fx:{'Remote-hired engineers':.45,'Parents & caregivers':.5,'Tenured ICs':.45,'Managers':-.1}},
   {label:'Commuter stipend + on-site childcare',detail:'$350/mo transit + childcare pilot at HQ',
    fx:{'Parents & caregivers':.75,'New grads':.2,'Sales & GTM':.1}}]},
{ id:'fare', title:'Raise metro fares 40% and retire monthly passes',
  sub:'city transit authority · 310k daily riders',
  text:'To close the operating deficit, single fares rise 40% next quarter and the discounted monthly pass program is retired. Revenue is earmarked for signal modernization.',
  beats:{2:{txt:'Local news profiles a nurse paying 9% of take-home pay on fares.',shift:{'Night-shift workers':-.1,'Daily commuters':-.08}},
         5:{txt:'Transit authority publishes the deficit numbers — insolvency in 30 months without action.',shift:{'Motorists':.06,'Transit staff':.08}},
         8:{txt:'A rider union announces a fare strike for the first Monday of the quarter.',shift:{'Students':-.1,'Daily commuters':-.06}}},
  cohorts:[
   {name:'Daily commuters',share:.24,base:-.66,vol:.8,inf:1.1,slot:5,hurt:null,tags:['cost of living','no alternative'],facOpp:'Fare Strike Bloc',facSup:'Reluctant Payers',
    q:{o:['A 40% jump with no pass? That\'s my grocery margin.','I have no car. "Choice" isn\'t in my vocabulary.'],n:['If it genuinely fixes the signals, maybe.'],s:['I\'d pay more for a train that actually comes.']}},
   {name:'Students',share:.15,base:-.78,vol:1,inf:.6,slot:2,hurt:null,tags:['fixed income','pass dependent'],facOpp:'Student Front',facSup:'—',
    q:{o:['The monthly pass is the only reason I can afford campus.','This prices out exactly the people with zero alternatives.'],n:['A student cap would change everything.'],s:['Fine if student pricing survives.']}},
   {name:'Night-shift workers',share:.09,base:-.84,vol:.7,inf:.4,slot:6,hurt:'They ride at hours with no bus alternative and are absent from every survey the authority ran — the fare hike lands hardest on the least consulted group in the city.',
    tags:['no alternative','unheard'],facOpp:'The 3AM Riders',facSup:'—',
    q:{o:['At 3am there is no other way home. None.','Nobody surveyed the night shift. Nobody ever does.','This is a tax on hospital cleaners and line cooks.'],n:['A night-fare freeze would be something.'],s:[]}},
   {name:'Occasional riders',share:.18,base:-.18,vol:.9,inf:.8,slot:7,hurt:null,tags:['convenience','parking'],facOpp:'Annoyed Occasionals',facSup:'Fair-Share Riders',
    q:{o:['I\'ll just drive. Congratulations.'],n:['I ride twice a month — barely notice either way.'],s:['Per-ride pricing is honestly fairer to people like me.']}},
   {name:'Motorists',share:.14,base:.32,vol:.6,inf:.9,slot:3,hurt:null,tags:['road funding','fairness'],facOpp:'—',facSup:'User-Pays Caucus',
    q:{o:['Push riders into cars and my commute doubles too.'],n:['Not my train, not my fight.'],s:['Riders covering their own system? Long overdue.']}},
   {name:'Transit staff',share:.1,base:.48,vol:.5,inf:.8,slot:4,hurt:null,tags:['solvency','jobs'],facOpp:'Worried Operators',facSup:'Keep-It-Running',
    q:{o:['Fare strikes get taken out on us at the platform.'],n:['Just fund it. I don\'t care how.'],s:['Without this, the system dies and my job with it.']}},
   {name:'Downtown businesses',share:.1,base:-.12,vol:.7,inf:1,slot:1,hurt:null,tags:['foot traffic','workforce'],facOpp:'Foot-Traffic Alliance',facSup:'Modernizers',
    q:{o:['Fewer riders is fewer customers at lunch. Simple.'],n:['Depends whether service actually improves.'],s:['Reliable signals mean reliable staff arrival times.']}}],
  amendments:[
   {label:'Keep monthly passes at +15%',detail:'pass survives, priced up moderately',
    fx:{'Daily commuters':.6,'Students':.55,'Night-shift workers':.3}},
   {label:'Night & off-peak fare freeze',detail:'no increase 9pm–6am and weekends',
    fx:{'Night-shift workers':.9,'Daily commuters':.15,'Students':.2}},
   {label:'Income-based fare cap',detail:'monthly spend capped at 3% of documented income',
    fx:{'Students':.65,'Night-shift workers':.6,'Daily commuters':.35,'Motorists':-.1}}]},
{ id:'ai', title:'Require AI-assistance disclosure on all student coursework',
  sub:'university senate policy · 28k students, 1,600 faculty',
  text:'All submitted coursework must declare every AI tool used and attach full prompt logs. Undeclared AI use is treated as academic dishonesty with a one-strike suspension policy.',
  beats:{2:{txt:'A viral post shows prompt logs exposing a student\'s disability accommodations.',shift:{'Students w/ accommodations':-.12,'Humanities students':-.06}},
         5:{txt:'Two departments publish evidence of grading collapse without disclosure norms.',shift:{'Faculty':.1,'TAs & graders':.08}},
         8:{txt:'Student senate proposes a privacy-preserving disclosure format.',shift:{'CS students':.08,'Students w/ accommodations':.06}}},
  cohorts:[
   {name:'CS students',share:.18,base:-.42,vol:1,inf:1.2,slot:1,hurt:null,tags:['tooling is the job','false positives'],facOpp:'Build-With-AI Bloc',facSup:'Honest Toolers',
    q:{o:['Industry requires these tools. The policy trains us for 2015.','Detection false-positives end careers under one-strike.'],n:['Disclosure fine, prompt logs absurd.'],s:['Declaring tools is what professionals do anyway.']}},
   {name:'Humanities students',share:.16,base:-.2,vol:.9,inf:.8,slot:7,hurt:null,tags:['surveillance','trust'],facOpp:'Pen & Privacy',facSup:'Original Voices',
    q:{o:['Submitting my thinking process for inspection is surveillance.'],n:['I don\'t use it much; I just hate the logging.'],s:['My degree shouldn\'t compete with a chatbot\'s prose.']}},
   {name:'Students w/ accommodations',share:.08,base:-.66,vol:.7,inf:.5,slot:6,hurt:'Prompt logs expose assistive-technology use that accommodations law explicitly keeps private; one-strike enforcement threatens exactly the students with least institutional power.',
    tags:['privacy','assistive tech'],facOpp:'Accommodation Rights',facSup:'—',
    q:{o:['My screen-reader workflow is in those logs. That\'s my medical privacy.','One strike, and appeals take a semester I don\'t have.'],n:['A redacted log format could work.'],s:[]}},
   {name:'Faculty',share:.22,base:.5,vol:.6,inf:1.4,slot:4,hurt:null,tags:['assessment integrity','grading'],facOpp:'Pragmatist Professors',facSup:'Integrity Caucus',
    q:{o:['Unenforceable rules teach contempt for all rules.'],n:['I just want to know what I\'m grading.'],s:['I cannot assess what I cannot see. Disclosure is the minimum.','Blind grading collapsed the moment generation got free.']}},
   {name:'TAs & graders',share:.12,base:.28,vol:.8,inf:.7,slot:3,hurt:null,tags:['grading load','ambiguity'],facOpp:'Overloaded Graders',facSup:'Clear-Rules Camp',
    q:{o:['I now adjudicate honesty cases at $19/hour?'],n:['Give me a rubric and I\'ll grade anything.'],s:['Right now every essay is a guessing game. Rules help.']}},
   {name:'Admissions & admin',share:.09,base:.38,vol:.5,inf:.9,slot:2,hurt:null,tags:['reputation','liability'],facOpp:'—',facSup:'Reputation Guard',
    q:{o:['One-strike suspensions are lawsuit generators.'],n:['Peer institutions are watching what we pick.'],s:['Employers are already asking what our degree certifies.']}},
   {name:'Parents & alumni',share:.15,base:.22,vol:.7,inf:.8,slot:8,hurt:null,tags:['degree value','fairness'],facOpp:'Due-Process Parents',facSup:'Standards Bearers',
    q:{o:['Suspension on an algorithm\'s accusation? Not with my kid.'],n:['I just want the degree to mean something.'],s:['We\'re paying for rigor. Protect it.']}}],
  amendments:[
   {label:'Drop prompt logs, keep tool declaration',detail:'declare tools used; logs never collected',
    fx:{'Students w/ accommodations':.7,'Humanities students':.5,'CS students':.35}},
   {label:'Replace one-strike with graduated response',detail:'warning → resubmission → hearing',
    fx:{'Students w/ accommodations':.5,'CS students':.4,'Parents & alumni':.3}},
   {label:'Course-level opt-in instead of blanket rule',detail:'instructors choose per course',
    fx:{'CS students':.5,'Faculty':-.15,'Humanities students':.3}}]}
];

const MAX_ROUNDS=12;
const STORE_KEY='agora-run-v1';

/* ─── simulation ─── */
class Sim{
  constructor(decision,seed,count,label){
    this.d=decision; this.seed=seed; this.count=count; this.label=label||'baseline';
    this.round=0; this.pendingFx=null; this.history=[]; this.factions=[];
    const rng=mulberry32(seed);
    this.personas=[]; this.adj=[];
    // personas: cohort assignment by share, deterministic
    const pool=[];
    decision.cohorts.forEach((c,ci)=>{const n=Math.round(c.share*count);
      for(let i=0;i<n;i++)pool.push(ci);});
    while(pool.length<count)pool.push(0);
    pool.length=count;
    for(let i=0;i<count;i++){
      const ci=pool[i],c=decision.cohorts[ci];
      this.personas.push({
        id:i,name:FIRST[Math.floor(rng()*FIRST.length)]+' '+LAST[Math.floor(rng()*LAST.length)],
        ci, stance:clamp(c.base+(rng()-.5)*.55,-1,1),
        stub:.25+rng()*.5, vol:c.vol, inf:(rng()<.08?1.6:0.4)+rng()*.6*c.inf,
        bias:0});
    }
    // social graph: mostly intra-cohort, some bridges; influencers get extra reach
    for(let i=0;i<count;i++){
      const p=this.personas[i],k=2+Math.floor(rng()*3)+(p.inf>1.4?3:0),nb=new Set();
      let guard=0;
      while(nb.size<k&&guard++<60){
        let j;
        if(rng()<.68){ // same cohort
          j=Math.floor(rng()*count);
          if(this.personas[j].ci!==p.ci)continue;
        } else j=Math.floor(rng()*count);
        if(j!==i)nb.add(j);
      }
      this.adj.push([...nb]);
    }
    // fixed vertical position by cohort band (x = stance, animated)
    this.pos=this.personas.map((p,i)=>({y:(p.ci+.5)/decision.cohorts.length+((rng()-.5)*.72)/decision.cohorts.length,
      x:0,vx:0,jit:rng()*Math.PI*2}));
    this.rng=rng;
    this.snapshot();
  }
  stances(){return this.personas.map(p=>p.stance)}
  snapshot(){this.history[this.round]=Float32Array.from(this.stances())}
  applyAmendment(a){ // sustained pull for the rest of the run — a policy change is permanent
    this.pendingFx={fx:a.fx,left:MAX_ROUNDS};
  }
  tick(){
    if(this.round>=MAX_ROUNDS)return false;
    this.round++;
    const prev=this.stances(),P=this.personas;
    const beat=this.d.beats[this.round];
    for(let i=0;i<P.length;i++){
      const p=P[i],c=this.d.cohorts[p.ci];
      let acc=0,wsum=0;
      for(const j of this.adj[i]){ // bounded confidence: distant opinions barely pull
        const w=P[j].inf*Math.max(.08,1-Math.abs(prev[j]-prev[i])*.75);
        acc+=w*(prev[j]-prev[i]);wsum+=w}
      const social=wsum?(acc/wsum)*.30*(1-p.stub):0;
      const harden=.045*Math.sign(prev[i])*Math.abs(prev[i]); // conviction hardening → polarization
      let shift=0;
      if(beat&&beat.shift[c.name])shift+=beat.shift[c.name];
      if(this.pendingFx&&this.pendingFx.fx[c.name])shift+=this.pendingFx.fx[c.name]/4;
      const noise=(this.rng()-.5)*.05*p.vol;
      p.stance=clamp(prev[i]+social+harden+shift+noise,-1,1);
    }
    if(this.pendingFx&&--this.pendingFx.left<=0)this.pendingFx=null;
    this.snapshot();
    if(this.round>=3)this.computeFactions();
    return true;
  }
  tally(stances){
    const s=stances||this.stances();
    let sup=0,opp=0;
    for(const v of s){if(v>.12)sup++;else if(v<-.12)opp++}
    return{sup,opp,neu:s.length-sup-opp,n:s.length};
  }
  meanByCohort(){
    return this.d.cohorts.map((c,ci)=>{
      const m=this.personas.filter(p=>p.ci===ci);
      return{c,ci,n:m.length,mean:m.reduce((a,p)=>a+p.stance,0)/(m.length||1),
        inf:m.reduce((a,p)=>a+p.inf,0)};
    });
  }
  computeFactions(){
    // emergent-ish: stance-bucket × dominant cohort, named from cohort faction pools
    const buckets={};
    this.personas.forEach(p=>{
      const b=p.stance<-.45?'opp':p.stance>.45?'sup':null;
      if(!b)return;
      const key=b+':'+p.ci;
      (buckets[key]=buckets[key]||{b,ci:p.ci,n:0}).n++;
    });
    this.factions=Object.values(buckets).filter(f=>f.n>=Math.max(6,this.count*.05))
      .sort((a,b)=>b.n-a.n).slice(0,4).map(f=>{
        const c=this.d.cohorts[f.ci];
        return{name:(f.b==='opp'?c.facOpp:c.facSup)||c.name,n:f.n,side:f.b,
          arg:c.tags[0],cohort:c.name};
      });
  }
  quote(p){
    const c=this.d.cohorts[p.ci];
    const pool=p.stance<-.15?c.q.o:p.stance>.15?c.q.s:c.q.n;
    if(!pool.length)return c.q.o[0]||'…';
    return pool[Math.floor(this.rng()*pool.length)];
  }
}

/* ─── app state ─── */
const S={sim:null,alt:null,running:false,speed:1,view:0,scrubbed:false,
  events:[],decisionIdx:0,seed:0,count:150,mirror:false,forkLabel:''};
const $=id=>document.getElementById(id);
const el=(t,cls,html)=>{const e=document.createElement(t);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e};

/* ─── setup view wiring ─── */
const samplesBox=$('samples');
const ICONS={rto:'🏢',fare:'🚇',ai:'🎓'};
DECISIONS.forEach((d,i)=>{
  const b=el('button','sample',
    `<span class="pick">✓</span><div class="ic">${ICONS[d.id]||'◈'}</div><b>${d.title}</b>
     <div class="meta">${d.sub}<br>${d.cohorts.length} cohorts · ${d.amendments.length} draft amendments</div>`);
  b.onclick=()=>{S.decisionIdx=i;$('decisionText').value=d.text;
    [...samplesBox.children].forEach((c,j)=>c.classList.toggle('sel',j===i));};
  samplesBox.append(b);
});
samplesBox.children[0].click();
$('popSize').oninput=e=>{$('popOut').textContent=e.target.value;S.count=+e.target.value};

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
$('materializeBtn').onclick=()=>openHarness();
function startRun(seed,saved){
  S.seed=seed;
  const d=DECISIONS[S.decisionIdx];
  S.sim=new Sim(d,seed,S.count,'baseline');
  S.alt=null;S.events=[];S.running=false;S.scrubbed=false;S.forkLabel='';
  if(saved){ // durable resume: replay persisted stance history
    saved.hist.forEach((h,r)=>{S.sim.history[r]=Float32Array.from(h)});
    S.sim.round=saved.round;
    S.sim.personas.forEach((p,i)=>p.stance=saved.hist[saved.round][i]);
    if(saved.round>=3)S.sim.computeFactions();
    if(saved.fork){
      S.alt=new Sim(d,seed,S.count,'amended');
      saved.altHist.forEach((h,r)=>{S.alt.history[r]=Float32Array.from(h)});
      S.alt.round=saved.round;
      S.alt.personas.forEach((p,i)=>p.stance=saved.altHist[saved.round][i]);
      if(saved.round>=3)S.alt.computeFactions();
      S.forkLabel=saved.forkLabel;enterForkUI();
    }
    S.events=saved.events||[];
    pushEvent({kind:'sys',html:'⏻ <b>Run resumed</b> from durable state at round '+saved.round+' — the process died, the simulation didn\'t.'});
  }
  $('rtitle').textContent=d.title;
  $('rsub').textContent=d.sub;
  $('popChip').textContent=S.sim.count+' personas · '+d.cohorts.length+' cohorts';
  $('setup').classList.remove('active');$('room').classList.add('active');
  sizeCanvases();
  if(!saved){
    pushEvent({kind:'sys',html:'◈ <b>'+S.sim.count+' personas materialized</b> across '+d.cohorts.length+' cohorts, wired into a '+S.sim.adj.reduce((a,x)=>a+x.length,0)+'-edge social graph. Round 0 = private reactions.'});
    materializeAnim();
  }
  renderAll();
}

/* ─── run loop ─── */
let tickTimer=null;
function setRunning(on){
  if(S.mirror)return;
  S.running=on&&S.sim.round<MAX_ROUNDS;
  $('runBtn').innerHTML=S.running?'⏸ Pause':'▶ Run';
  $('statusTxt').textContent=S.running?'LIVE':(S.sim.round>=MAX_ROUNDS?'COMPLETE':'PAUSED');
  $('statusDot').className='dot'+(S.running?' live':'');
  clearInterval(tickTimer);
  if(S.running)tickTimer=setInterval(tick,1600/S.speed);
}
$('runBtn').onclick=()=>setRunning(!S.running);
$('speedBtn').onclick=()=>{S.speed=S.speed===1?2:S.speed===2?4:1;
  $('speedBtn').textContent=S.speed+'×';if(S.running)setRunning(true)};
$('resetBtn').onclick=()=>{setRunning(false);localStorage.removeItem(STORE_KEY);
  $('room').classList.remove('active');$('setup').classList.add('active');
  exitForkUI();$('feed').innerHTML='';};
window.addEventListener('keydown',e=>{
  if(e.code==='Space'&&$('room').classList.contains('active')&&!e.target.closest('input,textarea')){
    e.preventDefault();setRunning(!S.running)}});

function tick(){
  const more=S.sim.tick();
  if(S.alt)S.alt.tick();
  S.scrubbed=false;
  narrate();
  persist();
  broadcast();
  renderAll();
  if(!more||S.sim.round>=MAX_ROUNDS){
    setRunning(false);
    pushEvent({kind:'sys',html:'▣ <b>Simulation complete</b> — '+MAX_ROUNDS+' rounds. Open the <b>Verdict</b>.'});
    renderFeed();
  }
}

/* narrative events for the round that just ran */
function narrate(){
  const r=S.sim.round,d=S.sim.d;
  if(d.beats[r])pushEvent({kind:'beat',html:'◆ <span class="tag" style="color:var(--warning)">EVENT</span> '+d.beats[r].txt});
  // a few voices from the floor
  const picks=[];
  for(let t=0;t<2;t++)picks.push(S.sim.personas[Math.floor(S.sim.rng()*S.sim.count)]);
  picks.forEach(p=>pushEvent({kind:'quote',p:{name:p.name,cohort:d.cohorts[p.ci].name,stance:p.stance},
    html:'“'+S.sim.quote(p)+'”'}));
  // faction emergence
  if(r>=3){
    const known=new Set(S.events.filter(e=>e.kind==='faction').map(e=>e.fname));
    S.sim.factions.forEach(f=>{
      if(!known.has(f.name))pushEvent({kind:'faction',fname:f.name,
        html:'⬡ <span class="tag" style="color:var(--c5)">FACTION EMERGED</span> <b>'+f.name+'</b> — '+f.n+' personas coalesced around “'+f.arg+'”. Nobody scripted this.'});
    });
  }
  // dissent agent
  if(r===3||r===7){
    const rows=S.sim.meanByCohort(),totInf=rows.reduce((a,x)=>a+x.inf,0);
    const target=rows.filter(x=>x.mean<-.3).sort((a,b)=>(a.inf/totInf)-(b.inf/totInf))[0];
    if(target&&target.c.hurt&&target.inf/totInf<.14){
      pushEvent({kind:'dissent',html:'⚠ <span class="tag">DISSENT AGENT</span> <b>'+target.c.name+'</b> — '
        +target.n+' personas, only '+pct(target.inf/totInf)+'% of network influence. '+target.c.hurt});
    }
  }
}
function pushEvent(e){e.round=S.sim?S.sim.round:0;S.events.push(e)}

/* ─── persistence (durable-resume showcase) ─── */
function persist(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify({
    decisionIdx:S.decisionIdx,seed:S.seed,count:S.count,round:S.sim.round,
    fork:!!S.alt,forkLabel:S.forkLabel,
    hist:S.sim.history.map(h=>[...h].map(v=>+v.toFixed(3))),
    altHist:S.alt?S.alt.history.map(h=>[...h].map(v=>+v.toFixed(3))):null,
    events:S.events.slice(-40)}));}catch(e){}
}
(function checkResume(){
  let saved=null;
  try{saved=JSON.parse(localStorage.getItem(STORE_KEY))}catch(e){}
  if(saved&&saved.round>0&&saved.round<MAX_ROUNDS){
    $('resumeBanner').style.display='flex';
    $('resumeBtn').onclick=()=>{S.decisionIdx=saved.decisionIdx;S.count=saved.count;
      startRun(saved.seed,saved)};
    $('discardBtn').onclick=()=>{localStorage.removeItem(STORE_KEY);
      $('resumeBanner').style.display='none'};
  }
})();

/* ─── cross-tab live mirror (the "second browser window" moment) ─── */
const bc='BroadcastChannel'in window?new BroadcastChannel('agora'):null;
function broadcast(){
  if(!bc||S.mirror)return;
  bc.postMessage({decisionIdx:S.decisionIdx,seed:S.seed,count:S.count,
    round:S.sim.round,st:[...S.sim.stances()],
    alt:S.alt?[...S.alt.stances()]:null,forkLabel:S.forkLabel,
    events:S.events.slice(-30).map(e=>({kind:e.kind,html:e.html,p:e.p,round:e.round,fname:e.fname}))});
}
if(bc)bc.onmessage=m=>{
  if(S.running)return; // this tab is the leader
  const d=m.data;
  S.mirror=true;
  if(!S.sim||S.seed!==d.seed){
    S.decisionIdx=d.decisionIdx;S.count=d.count;
    startRun(d.seed,null);
    $('feed').innerHTML='';
  }
  S.seed=d.seed;
  S.sim.round=d.round;
  S.sim.personas.forEach((p,i)=>p.stance=d.st[i]);
  S.sim.history[d.round]=Float32Array.from(d.st);
  if(d.round>=3)S.sim.computeFactions();
  if(d.alt){
    if(!S.alt){S.alt=new Sim(S.sim.d,d.seed,d.count,'amended');S.forkLabel=d.forkLabel;enterForkUI()}
    S.alt.round=d.round;
    S.alt.personas.forEach((p,i)=>p.stance=d.alt[i]);
    S.alt.history[d.round]=Float32Array.from(d.alt);
    if(d.round>=3)S.alt.computeFactions();
  }
  S.events=d.events;
  $('mirrorBanner').style.display='flex';
  ['runBtn','interveneBtn','resetBtn'].forEach(id=>$(id).disabled=true);
  $('statusTxt').textContent='MIRROR';$('statusDot').className='dot live';
  renderAll();
};

/* ─── intervention / fork ─── */
$('interveneBtn').onclick=()=>{
  if(S.alt){pushEvent({kind:'sys',html:'One fork per run in the prototype — reset to branch again.'});renderFeed();return}
  if(S.sim.round>=MAX_ROUNDS-2){pushEvent({kind:'sys',html:'Too late to fork — fewer than 2 rounds left. Reset for a fresh run.'});renderFeed();return}
  const list=$('amendList');list.innerHTML='';
  S.sim.d.amendments.forEach(a=>{
    const flips=estimateFlips(a);
    const b=el('button','amend',
      `<div><b>${a.label}</b><div style="color:var(--ink-3);font-size:11.5px;margin-top:2px">${a.detail}</div></div>
       <span class="fx"><b>≈${flips} flip</b>projected</span>`);
    b.onclick=()=>{fork(a);closeModals()};
    list.append(b);
  });
  $('interveneModal').classList.add('open');
};
$('customForkBtn').onclick=()=>{
  const t=$('amendCustom').value.trim();if(!t)return;
  const fx={};S.sim.d.cohorts.forEach(c=>{if(c.base<0)fx[c.name]=.35});
  fork({label:t,detail:'custom amendment',fx});closeModals();
};
function estimateFlips(a){ // silent 4-round clone — cheap, deterministic
  const r0=Math.min(S.sim.round,MAX_ROUNDS-4); // leave room to tick even post-completion
  const c=cloneSim(S.sim);c.round=r0;c.applyAmendment(a);
  for(let i=0;i<4;i++)c.tick();
  const b=cloneSim(S.sim);b.round=r0;
  for(let i=0;i<4;i++)b.tick();
  return Math.max(0,b.tally().opp-c.tally().opp);
}
function cloneSim(sim){
  const c=new Sim(sim.d,sim.seed,sim.count,sim.label);
  c.round=sim.round;
  c.personas.forEach((p,i)=>p.stance=sim.personas[i].stance);
  c.history=sim.history.slice();
  return c;
}
function fork(a){
  S.alt=cloneSim(S.sim);
  S.alt.label='amended';
  S.alt.applyAmendment(a);
  S.forkLabel=a.label;
  enterForkUI();
  pushEvent({kind:'sys',html:'⑂ <b>TIMELINE FORKED</b> at round '+S.sim.round+' — amendment: <b>'+a.label+'</b>. Both futures now simulate side by side.'});
  renderAll();
  if(!S.running)setRunning(true);
}
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
$('verdictBtn').onclick=()=>{
  const t=S.sim.tally(),ap=t.sup/t.n,op=t.opp/t.n;
  const rows=S.sim.meanByCohort(),totInf=rows.reduce((a,x)=>a+x.inf,0);
  const riskRow=rows.filter(x=>x.c.hurt).sort((a,b)=>a.mean-b.mean)[0]
    ||rows.sort((a,b)=>a.mean-b.mean)[0];
  const ranked=S.sim.d.amendments.map(a=>({a,flips:estimateFlips(a)}))
    .sort((x,y)=>y.flips-x.flips);
  let forkHtml='';
  if(S.alt){const ta=S.alt.tally();
    forkHtml=`<div class="vh"><div class="k">Amended fork</div>
      <div class="v" style="color:var(--sup)">${pct(ta.sup/ta.n)}%</div>
      <div class="d">approval · “${S.forkLabel}” · Δ ${pct(ta.sup/ta.n-ap)>=0?'+':''}${pct(ta.sup/ta.n-ap)} pts</div></div>`;
  }
  $('verdictBody').innerHTML=`
    <h2>Verdict · round ${S.sim.round}</h2>
    <div class="sub">${S.sim.d.title}</div>
    <div class="verdict-hero">
      <div class="vh"><div class="k">Predicted approval</div>
        <div class="v" style="color:var(--sup)">${pct(ap)}%</div>
        <div class="d">${t.sup} of ${t.n} personas support</div></div>
      <div class="vh"><div class="k">Opposition</div>
        <div class="v" style="color:var(--opp)">${pct(op)}%</div>
        <div class="d">${S.sim.factions.filter(f=>f.side==='opp').length||'no'} organized opposing faction(s)</div></div>
      ${forkHtml}
    </div>
    <div class="risk"><span class="tag">BIGGEST RISK</span><br>
      <b>${riskRow.c.name}</b> — mean stance ${riskRow.mean.toFixed(2)}, ${pct(riskRow.inf/totInf)}% of network influence.
      ${riskRow.c.hurt||'The most opposed cohort in the population.'}</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px">Amendments ranked by projected opposition flipped</div>
    ${ranked.map((r,i)=>`<div class="amend" style="cursor:default">
      <div><b>${i+1}. ${r.a.label}</b><div style="color:var(--ink-3);font-size:11.5px;margin-top:2px">${r.a.detail}</div></div>
      <span class="fx"><b>≈${r.flips} flip</b>projected</span></div>`).join('')}
    <div class="foot"><button class="btn primary" data-close>Close</button></div>`;
  $('verdictModal').classList.add('open');
};

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

let bornAt=0;
function materializeAnim(){bornAt=performance.now()}

function drawMap(cv,sim,viewStances){
  const ctx=cv.getContext('2d'),W=cv.width,H=cv.height,dpr=devicePixelRatio;
  ctx.clearRect(0,0,W,H);
  const st=viewStances||sim.stances();
  const now=performance.now();
  const px=i=>W/2+st[i]*W*.4;
  const py=i=>H*.06+sim.pos[i].y*H*.78;
  // center meridian
  ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;
  ctx.setLineDash([4*dpr,6*dpr]);
  ctx.beginPath();ctx.moveTo(W/2,H*.03);ctx.lineTo(W/2,H*.9);ctx.stroke();
  ctx.setLineDash([]);
  // edges (faint)
  ctx.lineWidth=Math.max(1,.7*dpr);
  for(let i=0;i<sim.count;i++){
    for(const j of sim.adj[i]){
      if(j<i)continue;
      const agree=1-Math.abs(st[i]-st[j])/2;
      ctx.strokeStyle=`rgba(200,200,200,${.028+agree*.03})`;
      ctx.beginPath();ctx.moveTo(px(i),py(i));ctx.lineTo(px(j),py(j));ctx.stroke();
    }
  }
  // animated positions with wobble; nodes
  for(let i=0;i<sim.count;i++){
    const p=sim.personas[i],pos=sim.pos[i];
    const tx=px(i)+Math.sin(now/1900+pos.jit)*2.4*dpr;
    pos.x=pos.x?lerp(pos.x,tx,.07):tx;
    const y=py(i)+Math.cos(now/2300+pos.jit)*2*dpr;
    const born=clamp((now-bornAt-i*9)/380,0,1);
    if(born<=0)continue;
    const r=(2.6+p.inf*2.6)*dpr*born;
    const glow=Math.abs(p.stance)>.6;
    if(glow){ctx.fillStyle=stanceColor(st[i],.18);
      ctx.beginPath();ctx.arc(pos.x,y,r*2.1,0,7);ctx.fill()}
    ctx.fillStyle=stanceColor(st[i],.95*born);
    ctx.beginPath();ctx.arc(pos.x,y,r,0,7);ctx.fill();
    if(p.inf>1.4){ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1*dpr;
      ctx.beginPath();ctx.arc(pos.x,y,r+2*dpr,0,7);ctx.stroke()}
    pos.sy=y;pos.sr=r; // for hit-testing
  }
}

/* node popover (drill-down) */
cvA.addEventListener('click',e=>nodeHit(e,cvA,S.sim));
cvB.addEventListener('click',e=>nodeHit(e,cvB,()=>S.alt));
function nodeHit(e,cv,simRef){
  const sim=typeof simRef==='function'?simRef():simRef;
  if(!sim)return;
  const r=cv.getBoundingClientRect(),dpr=devicePixelRatio;
  const mx=(e.clientX-r.left)*dpr,my=(e.clientY-r.top)*dpr;
  let best=-1,bd=1e9;
  for(let i=0;i<sim.count;i++){
    const p=sim.pos[i];if(p.sy==null)continue;
    const d=(p.x-mx)**2+(p.sy-my)**2;
    if(d<bd){bd=d;best=i}
  }
  if(best<0||bd>(22*dpr)**2){$('pop').style.display='none';return}
  const p=sim.personas[best],c=sim.d.cohorts[p.ci];
  const hist=sim.history.map(h=>h[best]);
  const spark=hist.map((v,i)=>`${(i/(Math.max(1,hist.length-1)))*100},${(1-(v+1)/2)*30+2}`).join(' ');
  const pop=$('pop');
  pop.innerHTML=`<div class="who"><b>${p.name}</b>
      <span class="stance-chip" style="color:${stanceColor(p.stance)}">${p.stance>=0?'+':''}${p.stance.toFixed(2)}</span></div>
    <span class="chip">${c.name}</span> ${p.inf>1.4?'<span class="chip">⭑ influencer</span>':''}
    <div class="quote">“${sim.quote(p)}”</div>
    <div style="font-size:10px;letter-spacing:.1em;color:var(--ink-3);font-weight:700">STANCE · R0 → R${sim.round}</div>
    <svg viewBox="0 0 100 34" preserveAspectRatio="none">
      <line x1="0" y1="17" x2="100" y2="17" stroke="var(--baseline)" stroke-width=".5"/>
      <polyline points="${spark}" fill="none" stroke="${stanceColor(p.stance)}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  pop.style.display='block';
  const pw=260;
  pop.style.left=Math.min(innerWidth-pw-12,e.clientX+14)+'px';
  pop.style.top=Math.min(innerHeight-190,e.clientY-20)+'px';
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#pop')&&!e.target.closest('canvas'))$('pop').style.display='none'});

/* tallies */
function renderTally(){
  const viewRound=S.scrubbed?+$('scrub').value:S.sim.round;
  const t=S.sim.tally(S.sim.history[viewRound]);
  const rows=[['Support',t.sup,'var(--sup)'],['Neutral',t.neu,'var(--neu)'],['Oppose',t.opp,'var(--opp)']];
  $('tallyRows').innerHTML=rows.map(([lab,n,col])=>`
    <div class="tally-row"><i style="width:10px;height:10px;border-radius:3px;background:${col}"></i>
      <span>${lab}</span><span class="bar"><i style="width:${n/t.n*100}%;background:${col}"></i></span>
      <span class="num"><b>${pct(n/t.n)}%</b> · ${n}</span></div>`).join('');
  $('apprChip').textContent=pct(t.sup/t.n)+'% approve';
  if(S.alt){
    const ta=S.alt.tally(S.alt.history[viewRound]||S.alt.history[S.alt.round]);
    const d=pct(ta.sup/ta.n)-pct(t.sup/t.n);
    $('tallyFork').innerHTML=`<b style="color:var(--ink)">⑂ Fork comparison</b>
      <div class="cmp"><span>Baseline approval</span><b>${pct(t.sup/t.n)}%</b></div>
      <div class="cmp"><span>Amended approval</span><b style="color:var(--sup)">${pct(ta.sup/ta.n)}% (${d>=0?'+':''}${d} pts)</b></div>`;
  }
}

/* opinion-drift river (stacked shares, 2px surface gaps, hover crosshair) */
function renderRiver(){
  const svg=$('river'),W=svg.clientWidth||330,Hh=128;
  svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);
  const hist=S.sim.history,n=hist.length;
  if(n<1){svg.innerHTML='';return}
  const padL=6,padR=44,padT=6,padB=16,iw=W-padL-padR,ih=Hh-padT-padB;
  const shares=hist.map(h=>{const t=S.sim.tally(h);return[t.sup/t.n,t.neu/t.n,t.opp/t.n]});
  const X=i=>padL+(n===1?iw/2:i/(n-1)*iw);
  const Y=v=>padT+(1-v)*ih;
  function band(lo,hi,color){
    let d='M'+X(0)+','+Y(hi(0));
    for(let i=1;i<n;i++)d+='L'+X(i)+','+Y(hi(i));
    for(let i=n-1;i>=0;i--)d+='L'+X(i)+','+Y(lo(i));
    return`<path d="${d}Z" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  const sup=i=>shares[i][0],neu=i=>shares[i][1];
  let out=band(i=>1-sup(i),i=>1,'var(--sup)')
        +band(i=>1-sup(i)-neu(i),i=>1-sup(i),'var(--neu)')
        +band(i=>0,i=>1-sup(i)-neu(i),'var(--opp)');
  // right-edge direct labels
  const last=shares[n-1];
  const yy=[1-last[0]/2,1-last[0]-last[1]/2,1-last[0]-last[1]-last[2]/2];
  ['Support','Neutral','Oppose'].forEach((lab,i)=>{
    if(last[i]<.04)return;
    out+=`<text x="${W-padR+5}" y="${Y(yy[i])+3}" font-size="9.5" fill="var(--ink-2)" font-family="var(--font)">${pct(last[i])}%</text>`;
  });
  out+=`<text x="${padL}" y="${Hh-4}" font-size="9" fill="var(--ink-3)">R0</text>
        <text x="${padL+iw-14}" y="${Hh-4}" font-size="9" fill="var(--ink-3)">R${n-1}</text>`;
  out+=`<line id="riverX" x1="0" x2="0" y1="${padT}" y2="${padT+ih}" stroke="var(--ink-3)" stroke-width="1" opacity="0"/>`;
  svg.innerHTML=out;
  // hover layer
  svg.onmousemove=e=>{
    const r=svg.getBoundingClientRect();
    const i=clamp(Math.round((e.clientX-r.left-padL)/(iw/(Math.max(1,n-1)))),0,n-1);
    const x=X(i),cross=svg.querySelector('#riverX');
    cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('opacity','.6');
    const tip=$('riverTip'),s=shares[i];
    tip.style.display='block';
    tip.innerHTML=`<b>Round ${i}</b><br>
      <span style="color:var(--sup)">▮</span> Support <b>${pct(s[0])}%</b> ·
      <span style="color:#8a8983">▮</span> Neutral <b>${pct(s[1])}%</b> ·
      <span style="color:var(--opp)">▮</span> Oppose <b>${pct(s[2])}%</b>`;
    const body=svg.parentElement.getBoundingClientRect();
    tip.style.left=clamp(e.clientX-body.left-70,0,body.width-190)+'px';
    tip.style.top='-8px';
  };
  svg.onmouseleave=()=>{$('riverTip').style.display='none';
    const c=svg.querySelector('#riverX');if(c)c.setAttribute('opacity','0')};
}

/* fork divergence — two approval lines, direct-labeled */
function renderDiverge(){
  if(!S.alt)return;
  const svg=$('diverge'),W=svg.clientWidth||330,Hh=104;
  svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);
  const padL=6,padR=64,padT=8,padB=14,iw=W-padL-padR,ih=Hh-padT-padB;
  const a=S.sim.history.map(h=>S.sim.tally(h)),b=S.alt.history.map(h=>S.alt.tally(h));
  const n=a.length;
  const X=i=>padL+(n===1?iw/2:i/(n-1)*iw),Y=v=>padT+(1-v)*ih;
  const line=(arr,col,w)=>'<polyline fill="none" stroke="'+col+'" stroke-width="'+w+'" points="'
    +arr.map((t,i)=>X(i)+','+Y(t.sup/t.n)).join(' ')+'"/>';
  const la=a[n-1],lb=b[b.length-1];
  svg.innerHTML=
    `<line x1="${padL}" x2="${padL+iw}" y1="${Y(.5)}" y2="${Y(.5)}" stroke="var(--grid)" stroke-width="1"/>`
    +line(a,'var(--ink-3)',1.6)+line(b,'var(--sup)',2)
    +`<circle cx="${X(n-1)}" cy="${Y(la.sup/la.n)}" r="3" fill="var(--ink-3)"/>
      <circle cx="${X(b.length-1)}" cy="${Y(lb.sup/lb.n)}" r="3" fill="var(--sup)"/>
      <text x="${X(n-1)+7}" y="${Y(la.sup/la.n)+3}" font-size="9.5" fill="var(--ink-3)">base ${pct(la.sup/la.n)}%</text>
      <text x="${X(b.length-1)+7}" y="${Y(lb.sup/lb.n)+3}" font-size="9.5" fill="var(--sup)">fork ${pct(lb.sup/lb.n)}%</text>`;
}

/* factions strips */
function renderFactions(){
  const put=(box,sim)=>{
    box.innerHTML='';
    (sim?sim.factions:[]).forEach(f=>{
      const c=el('div','faction',`<b>${f.name}</b>${f.n} personas · “${f.arg}”`);
      c.style.borderLeftColor=f.side==='opp'?'var(--opp)':'var(--sup)';
      box.append(c);
    });
  };
  put($('factionsA'),S.sim);put($('factionsB'),S.alt);
}

/* feed */
function renderFeed(){
  const feed=$('feed');
  const have=feed.children.length;
  const evs=S.events.slice(-42);
  if(S.mirror){feed.innerHTML='';} // mirrors rebuild (cheap, small list)
  const start=S.mirror?0:Math.max(0,evs.length-(evs.length- (have)));
  feed.innerHTML='';
  [...evs].reverse().forEach(e=>{
    const d=el('div','ev '+e.kind);
    if(e.kind==='quote'&&e.p){
      d.innerHTML=`<div class="who"><b>${e.p.name}</b><span class="chip">${e.p.cohort}</span>
        <span class="stance-chip" style="color:${stanceColor(e.p.stance)}">${e.p.stance>=0?'+':''}${e.p.stance.toFixed(2)}</span></div>${e.html}
        <div style="font-size:10px;color:var(--ink-3);margin-top:3px">round ${e.round}</div>`;
    }else d.innerHTML=e.html;
    feed.append(d);
  });
}

/* scrubber */
const scrub=$('scrub');
scrub.oninput=()=>{
  S.scrubbed=+scrub.value<S.sim.round;
  $('liveBtn').style.display=S.scrubbed?'inline-flex':'none';
  renderFrame();
};
$('liveBtn').onclick=()=>{S.scrubbed=false;scrub.value=S.sim.round;
  $('liveBtn').style.display='none';renderFrame()};

function renderFrame(){
  const vr=S.scrubbed?+scrub.value:S.sim.round;
  $('scrubLab').textContent='round '+vr+' / '+S.sim.round+(S.scrubbed?' · replay':'');
  $('roundPill').textContent='ROUND '+S.sim.round+'/'+MAX_ROUNDS;
  drawMap(cvA,S.sim,S.scrubbed?S.sim.history[vr]:null);
  if(S.alt)drawMap(cvB,S.alt,S.scrubbed?(S.alt.history[vr]||null):null);
  renderTally();
}
function renderAll(){
  if(!S.scrubbed){scrub.max=S.sim.round;scrub.value=S.sim.round}
  renderFrame();
  renderRiver();
  renderDiverge();
  renderFactions();
  renderFeed();
}

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
        ctx.strokeStyle=`rgba(150,165,200,${.055*(1-d2/max)})`;
        ctx.lineWidth=dpr*.7;
        ctx.beginPath();ctx.moveTo(pts[i].x*W,pts[i].y*H);ctx.lineTo(pts[j].x*W,pts[j].y*H);ctx.stroke();
      }
    }
    for(const p of pts){
      const col=p.side>0?'57,135,229':'230,103,103';
      ctx.fillStyle=`rgba(${col},.45)`;
      ctx.beginPath();ctx.arc(p.x*W,p.y*H,p.r*dpr,0,7);ctx.fill();
    }
  })();
})();

/* continuous canvas animation */
(function raf(){
  if($('room').classList.contains('active')&&S.sim){
    const vr=S.scrubbed?+scrub.value:S.sim.round;
    drawMap(cvA,S.sim,S.scrubbed?S.sim.history[vr]:null);
    if(S.alt)drawMap(cvB,S.alt,S.scrubbed?(S.alt.history[vr]||null):null);
  }
  requestAnimationFrame(raf);
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
  const d=DECISIONS[S.decisionIdx];
  $('harnessSub').textContent=d.title;
  const q=QUERY_DEFAULTS[d.id]||d.title;
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
  const r=await client.mutation(api.ingest.importX,{text:t});
  $('xImport').value='';
  $('xImportBtn').textContent=`Imported ${r.count} ✓`;
  setTimeout(()=>$('xImportBtn').textContent='Import X posts',2500);
};

/* live subscriptions — every open screen sees the same pipeline */
client.onUpdate(api.pipeline.latest,{},rows=>{
  const rail=$('pipeRail');rail.innerHTML='';
  const LAYERS=['L0','L1','L2','L3','L4','L5','L6'];
  const byLayer=Object.fromEntries(rows.map(r=>[r.layer,r]));
  LAYERS.forEach(l=>{
    const r=byLayer[l];
    const row=el('div','pipe-row '+(r?r.status:''),
      `<span class="lyr">${l}</span>
       <span class="det">${r?r.detail:['ingest','distill','populate','graph','simulate','voices','serve'][LAYERS.indexOf(l)]}</span>
       <span class="chip">${r?r.status:'idle'}</span>`);
    rail.append(row);
  });
});
client.onUpdate(api.ingest.sources,{},srcs=>{
  srcs.forEach(s=>{
    const chip=document.querySelector(`[data-status="${s.platform==='lemmy'?'reddit':s.platform}"]`);
    if(chip){chip.textContent=s.status==='done'?`${s.count} ✓`:s.status;
      chip.style.color=s.status==='failed'?'#f0a0a0':s.status==='done'?'var(--good)':'var(--ink-2)'}
  });
});
client.onUpdate(api.ingest.recentPosts,{limit:30},posts=>{
  const t=$('postTicker');if(!t)return;t.innerHTML='';
  posts.forEach(p=>{
    t.append(el('div','tick-post',
      `<div class="who"><b>@${p.author}</b><span class="chip">${p.platform}</span>▲ ${p.score}</div>${p.text}`));
  });
});
client.onUpdate(api.ingest.postCount,{},n=>{$('postTotal').textContent=n+' posts in corpus'});
