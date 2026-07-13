<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:DC0000,50:8B0000,100:1a0000&height=200&section=header&text=AGORA&fontColor=ffffff&fontSize=90&fontAlignY=38&desc=a%20Consequence%20Engine&descSize=22&descAlignY=60&animation=fadeIn" alt="AGORA — a Consequence Engine" width="100%" />

<a href="https://github.com/ayushap18/agora"><img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=22&pause=1000&color=DC0000&center=true&vCenter=true&width=820&lines=Every+decision+gets+debated+after+it+ships.;Agora+lets+you+watch+the+debate+before.;Crank+the+engine.+Drop+the+lights.+Run+it+live." alt="tagline" /></a>

<br/>

![Convex](https://img.shields.io/badge/Convex-reactive%20backend-DC0000?style=for-the-badge&labelColor=1a0000)
![Vite](https://img.shields.io/badge/Vite-vanilla%20UI-8B0000?style=for-the-badge&labelColor=1a0000)
![Go](https://img.shields.io/badge/Go-corpus%20sidecar-DC0000?style=for-the-badge&labelColor=1a0000)
![Ruby](https://img.shields.io/badge/Ruby-corpus%20cache-8B0000?style=for-the-badge&labelColor=1a0000)

![personas](https://img.shields.io/badge/1%2C800-personas-DC0000?style=flat-square&labelColor=1a0000)
![rounds](https://img.shields.io/badge/12-durable%20rounds-DC0000?style=flat-square&labelColor=1a0000)
![sources](https://img.shields.io/badge/5-live%20sources-DC0000?style=flat-square&labelColor=1a0000)
![layers](https://img.shields.io/badge/7-observable%20layers-DC0000?style=flat-square&labelColor=1a0000)
![websockets](https://img.shields.io/badge/0-websockets%20of%20ours-DC0000?style=flat-square&labelColor=1a0000)

</div>

---

> 🏁 **Paste a decision. Watch who it hurts — before it ships.**

Agora pulls **real posts** (Reddit·HN·Bluesky·Mastodon, +X import), distills them into
stakeholder **cohorts**, grows an **1,800-persona graph**, and runs a **durable
simulation** where opinions spread by bounded-confidence influence. Factions emerge, a
Dissent Agent names the quietly-hurt, and you can **fork the timeline mid-run** — all
streaming live to every open browser via Convex reactive queries. Wrapped in an F1
**pit-wall skin**: crank the engine, lights out, run the lap.

## ⚡ Run it

```sh
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev   # local backend, no account
npx vite --port 8642                          # second terminal → localhost:8642
```

Optional real LLM voices: `npx convex env set GEMINI_API_KEY <key>`. No key → deterministic
fallback from the real corpus, nothing blocks.

## 🏎️ The pipeline — 7 layers, all live

```mermaid
%%{init:{'theme':'base','themeVariables':{'primaryColor':'#2a0000','primaryBorderColor':'#DC0000','primaryTextColor':'#fff','lineColor':'#DC0000','fontFamily':'monospace'}}}%%
flowchart LR
  subgraph SRC[" real world "]
    R[Reddit→Lemmy]:::s
    H[Hacker News]:::s
    B[Bluesky]:::s
    M[Mastodon]:::s
  end
  R & H & B & M --> L0
  L0[L0 · INGEST<br/>fetch + dedupe]:::l --> L1[L1 · DISTILL<br/>6–8 cohorts]:::l
  L1 --> L2[L2 · POPULATE<br/>1,800 personas]:::l
  L2 --> L3[L3 · GRAPH<br/>homophily net]:::l
  L3 --> L4[L4 · SIMULATE<br/>12 durable rounds]:::w
  L4 --> L5[L5 · VOICES<br/>quotes · dissent]:::l
  L5 --> L6[L6 · SERVE<br/>reactive queries]:::l
  L6 --> UI[[every browser<br/>in sync]]:::u
  classDef s fill:#1a0000,stroke:#8B0000,color:#ff6b6b;
  classDef l fill:#2a0000,stroke:#DC0000,color:#fff;
  classDef w fill:#DC0000,stroke:#fff,color:#fff;
  classDef u fill:#440000,stroke:#DC0000,color:#fff;
```

`L4` is a **Convex Workflow** — kill `convex dev` mid-run, restart, it resumes where it
died. `L5` runs on a **Workpool** (4-parallel) + **Rate Limiter** (8/min). `L6` is plain
reactive queries — **zero websocket code of ours**. Stance math is deterministic and
seeded; LLMs voice the debate, they never move the numbers.

## 🏁 One lap

```mermaid
%%{init:{'theme':'base','themeVariables':{'primaryColor':'#2a0000','primaryBorderColor':'#DC0000','primaryTextColor':'#fff','lineColor':'#DC0000','fontFamily':'monospace'}}}%%
flowchart TD
  I([🔴 Start the engine]):::go --> F[~10s ignition film<br/>systems check · rosso wipe]:::n
  F --> P[Pit wall<br/>telemetry + garage]:::n
  P --> HN[Harness console<br/>fetch · distill · build net]:::n
  HN --> W{War room · Run}:::hot
  W --> POL[1,800 nodes polarize<br/>Dissent Agent fires @3/7]:::n
  POL --> FORK[⚡ Intervene → timelines fork]:::n
  FORK --> V([Verdict · approval% · risk<br/>amendments ranked by flips]):::go
  classDef go fill:#DC0000,stroke:#fff,color:#fff;
  classDef hot fill:#8B0000,stroke:#DC0000,color:#fff;
  classDef n fill:#2a0000,stroke:#DC0000,color:#fff;
```

Copy the URL (`#run=<id>`) into another browser/device → identical live state, no refresh.
That's the whole pitch in one gesture.

## 🔧 Extras

| Command | What |
|---|---|
| `cd scraper && go run . -q "…" -pages 4` | Go sidecar — concurrent scrape, ~550 posts/~5s, bulk-insert via HTTP |
| `ruby cache/corpus_cache.rb pull\|replay -q "…"` | snapshot/replay corpus offline, zero network |
| `npx convex run selftest:run` | prove engine invariants (determinism, bounds, conservation) |
| `npx convex run ops:cleanup` | keep latest baseline + forks, cascade-delete the rest |
| ⚙ Settings | BYOK Gemini · Ollama · HF token · rounds 6–20 · tick speed · model council |

**LLM tiers:** local (Ollama) → Gemini → deterministic fallback; the pit wall shows which
is live. **Model council:** each configured model blind-predicts final approval%; scored
against the engine's ground truth (100 − |error|).

## 📁 Repo map

```
convex/     schema · ingest · distill · populate · engine · sim(workflow) · voices · serve · council · selftest · ops
src/        main.js (war-room canvas/SVG + Convex adapters + pit-wall chrome) · ignition.js (engine-start film)
index.html  all views — landing · pit wall · harness · war room · settings
scraper/    Go corpus sidecar          cache/  Ruby corpus cache          docs/  design spec + plan
```

<div align="center"><sub>Nav · <b>Home → Pit wall → Harness → War room → Settings</b> · every screen mirrors the same lap 🔴</sub></div>
