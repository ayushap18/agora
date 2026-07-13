import { Workpool } from "@convex-dev/workpool";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { api, components, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { llmJson, getCfg } from "./llm";
import { embedOne } from "./embed";
import { mulberry32 } from "./populate";

const pool = new Workpool(components.voicesPool, { maxParallelism: 4 });
const rl = new RateLimiter(components.rateLimiter, {
  gemini: { kind: "token bucket", rate: 8, period: MINUTE },
});

// Called by the workflow each round: pick speakers, fan out through the pool.
export const schedule = internalMutation({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async (ctx, { runId, round }) => {
    const run = (await ctx.db.get(runId))!;
    if (run.silent) return;
    const prev = await stances(ctx, runId, round - 1);
    const cur = await stances(ctx, runId, round);
    if (!cur.length) return;
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q: any) => q.eq("runId", runId)).collect();
    pcs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
    const inf = pcs.flatMap((c: any) => c.inf);

    // speakers: top-3 movers, top-2 influencers weighted by |stance|, 2 seeded-random
    const movers = cur.map((s, i) => ({ i, d: Math.abs(s - (prev[i] ?? s)) }))
      .sort((a, b) => b.d - a.d).slice(0, 3).map((x) => x.i);
    const loud = cur.map((s, i) => ({ i, w: inf[i] * Math.abs(s) }))
      .sort((a, b) => b.w - a.w).slice(0, 2).map((x) => x.i);
    const rng = mulberry32(run.config.seed + round * 31);
    const rand = [(rng() * cur.length) | 0, (rng() * cur.length) | 0];
    const speakers = [...new Set([...movers, ...loud, ...rand])].slice(0, 6);

    for (const idx of speakers) {
      await pool.enqueueAction(ctx, internal.voices.speak, { runId, round, idx });
    }
    // dissent agent fires twice per run; synthesis every 3 rounds
    if (round === 3 || round === 7) {
      await pool.enqueueAction(ctx, internal.voices.dissent, { runId, round });
    }
    if (round % 3 === 0 || round === run.config.rounds) {
      await pool.enqueueAction(ctx, internal.voices.synthesize, { runId, round });
    }
  },
});

async function stances(ctx: any, runId: any, round: number): Promise<number[]> {
  if (round < 0) return [];
  const scs = await ctx.db.query("stanceChunks")
    .withIndex("by_run_round", (q: any) => q.eq("runId", runId).eq("round", round)).collect();
  scs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
  return scs.flatMap((c: any) => c.values);
}

export const speakerContext = internalQuery({
  args: { runId: v.id("runs"), round: v.number(), idx: v.number() },
  handler: async (ctx, { runId, round, idx }) => {
    const run = (await ctx.db.get(runId))!;
    const chunk = await ctx.db.query("personaChunks")
      .withIndex("by_run", (q: any) => q.eq("runId", runId).eq("chunkIdx", (idx / 500) | 0)).first();
    if (!chunk) return null;
    const local = idx % 500;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q: any) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a: any, b: any) => a.idx - b.idx);
    const cohort = cohorts[chunk.cohortIdx[local]];
    const decision = (await ctx.db.get(run.decisionId))!;
    const cur = await stances(ctx, runId, round);
    const seedRefId = chunk.seedRef[local];
    const seedPost = seedRefId ? await ctx.db.get(seedRefId) : null;
    const myVoices = (await ctx.db.query("voices")
      .withIndex("by_run", (q: any) => q.eq("runId", runId)).collect())
      .filter((vc: any) => vc.personaIdx === idx).slice(-2);
    return {
      name: chunk.names[local], cohort: cohort?.name ?? "—", cohortIdx: chunk.cohortIdx[local],
      seedQuotes: cohort?.seedQuotes ?? { o: [], n: [], s: [] },
      stance: cur[idx] ?? 0,
      decisionTitle: decision.title,
      amendment: run.amendment?.label ?? null,
      seedText: seedPost?.text?.slice(0, 260) ?? null,
      seedUrl: (seedPost as any)?.url ?? null,
      priorSaid: myVoices.map((vc: any) => vc.text),
    };
  },
});

export const insertVoice = internalMutation({
  args: {
    runId: v.id("runs"), round: v.number(), personaIdx: v.number(),
    name: v.string(), cohort: v.string(), stance: v.number(),
    text: v.string(), kind: v.string(), sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, a) => { await ctx.db.insert("voices", a); },
});

export const speak = internalAction({
  args: { runId: v.id("runs"), round: v.number(), idx: v.number() },
  handler: async (ctx, { runId, round, idx }) => {
    const c: any = await ctx.runQuery(internal.voices.speakerContext, { runId, round, idx });
    if (!c) return;
    // RAG: vector-search the corpus for the grievance most relevant to this
    // persona's cohort + current lean; beats the random seedRef when available
    try {
      const cfg = await getCfg(ctx);
      const qv = await embedOne(cfg,
        `${c.decisionTitle}. ${c.cohort} perspective, ${c.stance < -0.15 ? "opposed" : c.stance > 0.15 ? "supportive" : "undecided"}.`);
      if (qv) {
        const hits = await ctx.vectorSearch("posts", "by_embedding", {
          vector: qv, limit: 3, filter: (q) => q.eq("cohortIdx", c.cohortIdx),
        });
        if (hits.length) {
          const best: any = await ctx.runQuery(internal.voices.postText, { postId: hits[0]._id });
          if (best) { c.seedText = best.text; c.seedUrl = best.url ?? c.seedUrl; c.rag = true; }
        }
      }
    } catch { /* retrieval is best-effort */ }
    let text: string | null = null;
    const ok = await rl.limit(ctx, "gemini");
    if (ok.ok) {
      const g = await llmJson(ctx,
`You are ${c.name}, a member of "${c.cohort}", reacting in round ${round} of an ongoing debate about:
"${c.decisionTitle}"${c.amendment ? `\nAn amendment is now in effect: "${c.amendment}"` : ""}
Your current stance: ${c.stance.toFixed(2)} (-1 opposed .. +1 supportive).
${c.seedText ? `Your views grew out of this real post: "${c.seedText}"` : ""}
${c.priorSaid.length ? `You previously said: ${c.priorSaid.map((s: string) => `"${s}"`).join(" / ")} — stay consistent, evolve, don't repeat.` : ""}
Write ONE punchy in-character remark (max 160 chars) for the live discussion floor.
Return JSON: {"text": "..."}`);
      if (g?.text) text = String(g.text).slice(0, 180);
    }
    if (!text) {
      // fallback: cohort seed quotes bucketed by stance (never blocks the round)
      const q = c.seedQuotes;
      const pool2 = c.stance < -0.15 ? q.o : c.stance > 0.15 ? q.s : q.n;
      const all = pool2.length ? pool2 : [...q.o, ...q.n, ...q.s];
      if (!all.length) return;
      text = all[(Math.abs(idx * 31 + round * 7) % all.length)];
    }
    await ctx.runMutation(internal.voices.insertVoice, {
      runId, round, personaIdx: idx, name: c.name, cohort: c.cohort,
      stance: c.stance, text, kind: "quote", sourceUrl: c.seedUrl ?? undefined,
    });
  },
});

export const cohortStats = internalQuery({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async (ctx, { runId, round }) => {
    const run = (await ctx.db.get(runId))!;
    const cur = await stances(ctx, runId, round);
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q: any) => q.eq("runId", runId)).collect();
    pcs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
    const cohortIdx = pcs.flatMap((c: any) => c.cohortIdx);
    const inf = pcs.flatMap((c: any) => c.inf);
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q: any) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a: any, b: any) => a.idx - b.idx);
    const decision = (await ctx.db.get(run.decisionId))!;
    const stats = cohorts.map((c: any) => ({ name: c.name, hurt: c.hurt ?? null, n: 0, mean: 0, inf: 0 }));
    let totInf = 0;
    for (let i = 0; i < cur.length; i++) {
      const s = stats[cohortIdx[i]]; if (!s) continue;
      s.n++; s.mean += cur[i]; s.inf += inf[i]; totInf += inf[i];
    }
    stats.forEach((s) => { s.mean = s.n ? s.mean / s.n : 0; s.inf = totInf ? s.inf / totInf : 0; });
    let sup = 0, opp = 0;
    for (const s of cur) { if (s > 0.12) sup++; else if (s < -0.12) opp++; }
    return { stats, decisionTitle: decision.title, tally: { sup, opp, neu: cur.length - sup - opp, n: cur.length } };
  },
});

export const dissent = internalAction({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async (ctx, { runId, round }) => {
    const { stats, decisionTitle }: any = await ctx.runQuery(internal.voices.cohortStats, { runId, round });
    const target = stats.filter((s: any) => s.mean < -0.25 && s.n > 10)
      .sort((a: any, b: any) => a.inf - b.inf)[0];
    if (!target) return;
    let text = `${target.name} — ${target.n} personas, only ${Math.round(target.inf * 100)}% of network influence. ` +
      (target.hurt ?? "Strongly opposed, structurally voiceless: they lose this debate without ever being heard in it.");
    const ok = await rl.limit(ctx, "gemini");
    if (ok.ok) {
      const g = await llmJson(ctx,
`You are the DISSENT AGENT: your only job is naming who gets quietly hurt.
Decision: "${decisionTitle}". The cohort "${target.name}" (${target.n} members, mean stance ${target.mean.toFixed(2)}, ${Math.round(target.inf * 100)}% of network influence${target.hurt ? `, context: ${target.hurt}` : ""}) is losing with the least voice.
One sharp sentence (max 200 chars) naming the quiet harm. Return JSON: {"text":"..."}`);
      if (g?.text) text = `${target.name} — ${String(g.text).slice(0, 220)}`;
    }
    await ctx.runMutation(internal.voices.insertVoice, {
      runId, round, personaIdx: -1, name: "Dissent Agent", cohort: target.name,
      stance: target.mean, text, kind: "dissent",
    });
  },
});

export const synthesize = internalAction({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async (ctx, { runId, round }) => {
    const { stats, decisionTitle, tally }: any = await ctx.runQuery(internal.voices.cohortStats, { runId, round });
    const pct = (x: number) => Math.round((x / tally.n) * 100);
    let text = `Round ${round}: ${pct(tally.sup)}% support · ${pct(tally.neu)}% undecided · ${pct(tally.opp)}% opposed. ` +
      `Hardest opposition: ${stats.slice().sort((a: any, b: any) => a.mean - b.mean)[0]?.name ?? "—"}.`;
    const ok = await rl.limit(ctx, "gemini");
    if (ok.ok) {
      const g = await llmJson(ctx,
`Synthesize round ${round} of a simulated public debate on "${decisionTitle}".
Tally: ${pct(tally.sup)}% support, ${pct(tally.neu)}% undecided, ${pct(tally.opp)}% opposed.
Cohorts: ${stats.map((s: any) => `${s.name} (${s.n}p, mean ${s.mean.toFixed(2)})`).join("; ")}.
Two sentences max, analyst voice, no hedging. Return JSON: {"text":"..."}`);
      if (g?.text) text = String(g.text).slice(0, 300);
    }
    await ctx.runMutation(internal.voices.insertVoice, {
      runId, round, personaIdx: -2, name: "Synthesizer", cohort: "—",
      stance: 0, text, kind: "synthesis",
    });
  },
});

export const postText = internalQuery({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) => {
    const p = await ctx.db.get(postId);
    return p ? { text: p.text.slice(0, 260), url: p.url ?? null } : null;
  },
});

// LLM-computed custom amendment: the model decides which cohorts move and how much
export const customAmendment = internalAction({
  args: { runId: v.id("runs"), label: v.string() },
  handler: async (ctx, { runId, label }): Promise<Record<string, number> | null> => {
    const c: any = await ctx.runQuery(internal.sim.forkContext, { runId });
    const g = await llmJson(ctx,
`Decision under debate: "${c.title}". Proposed amendment: "${label}".
Cohorts (name, population share, base stance -1..1):
${c.cohorts.map((x: any) => `- ${x.name}: ${(x.share * 100).toFixed(0)}%, ${x.baseStance.toFixed(2)}`).join("\n")}
For each cohort this amendment would sway, give a stance shift in [-1, 1]
(positive = toward support). Omit unaffected cohorts. Be selective and realistic.
Return JSON: {"fx": {"<cohort name>": <shift>, ...}}`);
    if (!g?.fx || typeof g.fx !== "object") return null;
    const fx: Record<string, number> = {};
    for (const [k, v2] of Object.entries(g.fx)) {
      const num = Number(v2);
      if (c.cohorts.some((x: any) => x.name === k) && Number.isFinite(num))
        fx[k] = Math.max(-1, Math.min(1, num));
    }
    return Object.keys(fx).length ? fx : null;
  },
});

export const customFork = internalAction({
  args: { runId: v.id("runs"), label: v.string() },
  handler: async (ctx, { runId, label }) => {
    const fx = await ctx.runAction(internal.voices.customAmendment, { runId, label });
    // fx null → sim.fork's heuristic 'custom' mode takes over
    await ctx.runMutation(api.sim.fork, { runId, label, mode: "custom", fx: fx ?? undefined });
    return { llm: !!fx, fx };
  },
});
