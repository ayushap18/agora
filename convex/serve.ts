import { query } from "./_generated/server";
import { v } from "convex/values";
import { tallyOf } from "./engine";
import { CHUNK } from "./populate";

async function stancesAt(ctx: any, runId: any, round: number): Promise<number[]> {
  const scs = await ctx.db.query("stanceChunks")
    .withIndex("by_run_round", (q: any) => q.eq("runId", runId).eq("round", round)).collect();
  scs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
  return scs.flatMap((c: any) => c.values);
}

export const debugCounts = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    const scs = await ctx.db.query("stanceChunks").withIndex("by_run_round", (q) => q.eq("runId", runId)).collect();
    return {
      status: run?.status, round: run?.round,
      personas: pcs.reduce((a, c) => a + c.names.length, 0),
      chunks: pcs.length,
      edges: acs.reduce((a, c) => a + c.flatAdj.length, 0),
      stanceRows: scs.length,
    };
  },
});

// One-time per run per client: everything static (~60KB). The hot liveState
// subscription stays slim.
export const personaMeta = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    pcs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    acs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    return {
      names: pcs.flatMap((c) => c.names),
      cohortIdx: pcs.flatMap((c) => c.cohortIdx),
      inf: pcs.flatMap((c) => c.inf),
      adj: acs.map((c) => ({ flatAdj: c.flatAdj, offsets: c.offsets })),
    };
  },
});

// Hot subscription: per-round dynamics only.
export const liveState = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const values = await stancesAt(ctx, runId, run.round);
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);
    const factionRows = await ctx.db.query("factions")
      .withIndex("by_run", (q) => q.eq("runId", runId).eq("round", run.round)).collect();
    return {
      run: {
        _id: run._id, decisionId: run.decisionId, label: run.label, status: run.status,
        round: run.round, rounds: run.config.rounds, n: run.config.n, seed: run.config.seed,
        parentRunId: run.parentRunId ?? null, forkedAtRound: run.forkedAtRound ?? null,
        amendment: run.amendment ?? null,
      },
      stances: values,
      tally: tallyOf(values),
      cohorts: cohorts.map((c) => ({ idx: c.idx, name: c.name, hurt: c.hurt ?? null, tags: c.tags })),
      factions: factionRows[0]?.list ?? [],
    };
  },
});

// O(rounds) indexed read; falls back to computing for runs that predate roundStats.
export const timeline = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
    const stats = await ctx.db.query("roundStats")
      .withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    if (stats.length) {
      return stats.sort((a, b) => a.round - b.round)
        .map((s) => ({ round: s.round, sup: s.sup, opp: s.opp, neu: s.neu, n: s.n }));
    }
    const out = [];
    for (let r = 0; r <= run.round; r++) {
      const values = await stancesAt(ctx, runId, r);
      if (values.length) out.push({ round: r, ...tallyOf(values) });
    }
    return out;
  },
});

export const roundStances = query({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async (ctx, { runId, round }) => await stancesAt(ctx, runId, round),
});

export const feed = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const vs = await ctx.db.query("voices")
      .withIndex("by_run", (q) => q.eq("runId", runId)).order("desc").take(30);
    const evs = await ctx.db.query("events")
      .withIndex("by_run", (q) => q.eq("runId", runId)).order("desc").take(15);
    return [
      ...vs.map((x) => ({ t: x._creationTime, type: "voice", ...x })),
      ...evs.map((x) => ({ t: x._creationTime, type: "event", ...x })),
    ].sort((a, b) => b.t - a.t).slice(0, 40);
  },
});

export const runsForDecision = query({
  args: { decisionId: v.id("decisions") },
  handler: async (ctx, { decisionId }) => {
    const runs = await ctx.db.query("runs")
      .withIndex("by_decision", (q) => q.eq("decisionId", decisionId)).order("desc").take(20);
    return runs.filter((r) => !r.silent).map((r) => ({
      _id: r._id, label: r.label, status: r.status, round: r.round,
      parentRunId: r.parentRunId ?? null, forkedAtRound: r.forkedAtRound ?? null,
      amendment: r.amendment ?? null, n: r.config.n,
    }));
  },
});

// persona drill-down (map click)
export const persona = query({
  args: { runId: v.id("runs"), idx: v.number() },
  handler: async (ctx, { runId, idx }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const chunkIdx = (idx / CHUNK) | 0, local = idx % CHUNK;
    const chunk = await ctx.db.query("personaChunks")
      .withIndex("by_run", (q) => q.eq("runId", runId).eq("chunkIdx", chunkIdx)).first();
    if (!chunk) return null;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);
    const hist: number[] = [];
    for (let r = 0; r <= run.round; r++) {
      const sc = await ctx.db.query("stanceChunks")
        .withIndex("by_run_round", (q) => q.eq("runId", runId).eq("round", r).eq("chunkIdx", chunkIdx)).first();
      if (sc) hist.push(sc.values[local]);
    }
    const seedRefId = chunk.seedRef[local];
    const seedPost = seedRefId ? await ctx.db.get(seedRefId) : null;
    return {
      name: chunk.names[local],
      cohort: cohorts[chunk.cohortIdx[local]]?.name ?? "—",
      inf: chunk.inf[local],
      hist,
      seedPost: seedPost
        ? { text: seedPost.text.slice(0, 200), platform: seedPost.platform, url: seedPost.url ?? null, author: seedPost.author }
        : null,
    };
  },
});

// flip estimates: the silent children are always exactly one batch
// (sim.estimate deletes the previous batch before spawning).
export const estimates = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const kids = (await ctx.db.query("runs")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect())
      .filter((r) => r.silent && r.parentRunId === runId);
    if (!kids.length) return null;
    const rows = [];
    let controlOpp: number | null = null;
    for (const k of kids) {
      const stats = await ctx.db.query("roundStats")
        .withIndex("by_run", (q) => q.eq("runId", k._id).eq("round", k.round)).first();
      const opp = stats ? stats.opp : tallyOf(await stancesAt(ctx, k._id, k.round)).opp;
      if (k.label === "__control__") { controlOpp = opp; continue; }
      rows.push({ label: k.label, opp, done: k.status === "complete" });
    }
    return {
      allDone: kids.every((k) => k.status === "complete"),
      rows: rows.map((r) => ({
        label: r.label,
        flips: controlOpp === null ? 0 : Math.max(0, controlOpp - r.opp),
        done: r.done,
      })).sort((a, b) => b.flips - a.flips),
    };
  },
});

// decision context for mirrors/hash-loaded tabs (title + amendments come from
// the server, never from local sample data)
export const decision = query({
  args: { decisionId: v.id("decisions") },
  handler: async (ctx, { decisionId }) => {
    const d = await ctx.db.get(decisionId);
    return d ? { title: d.title, body: d.body, amendments: d.amendments } : null;
  },
});
