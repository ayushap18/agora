import { query } from "./_generated/server";
import { v } from "convex/values";

function tallyOf(values: number[]) {
  let sup = 0, opp = 0;
  for (const s of values) { if (s > 0.12) sup++; else if (s < -0.12) opp++; }
  return { sup, opp, neu: values.length - sup - opp, n: values.length };
}

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

// One subscription drives map + tally: current-round stances + persona meta.
export const liveState = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const values = await stancesAt(ctx, runId, run.round);
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    pcs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);
    const factionRows = await ctx.db.query("factions")
      .withIndex("by_run", (q) => q.eq("runId", runId).eq("round", run.round)).collect();
    return {
      run: {
        _id: run._id, label: run.label, status: run.status, round: run.round,
        rounds: run.config.rounds, n: run.config.n, seed: run.config.seed,
        parentRunId: run.parentRunId ?? null, forkedAtRound: run.forkedAtRound ?? null,
        amendment: run.amendment ?? null,
      },
      stances: values,
      tally: tallyOf(values),
      cohortIdx: pcs.flatMap((c) => c.cohortIdx),
      inf: pcs.flatMap((c) => c.inf),
      cohorts: cohorts.map((c) => ({ idx: c.idx, name: c.name, hurt: c.hurt ?? null, tags: c.tags })),
      factions: factionRows[0]?.list ?? [],
    };
  },
});

export const timeline = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
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
    const chunk = await ctx.db.query("personaChunks")
      .withIndex("by_run", (q) => q.eq("runId", runId).eq("chunkIdx", (idx / 500) | 0)).first();
    if (!chunk) return null;
    const local = idx % 500;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);
    const hist: number[] = [];
    for (let r = 0; r <= run.round; r++) {
      const sc = await ctx.db.query("stanceChunks")
        .withIndex("by_run_round", (q) => q.eq("runId", runId).eq("round", r).eq("chunkIdx", (idx / 500) | 0)).first();
      if (sc) hist.push(sc.values[local]);
    }
    const seedRefId = chunk.seedRef[local];
    const seedPost = seedRefId ? await ctx.db.get(seedRefId) : null;
    return {
      name: chunk.names[local],
      cohort: cohorts[chunk.cohortIdx[local]]?.name ?? "—",
      inf: chunk.inf[local],
      hist,
      seedPost: seedPost ? { text: seedPost.text.slice(0, 200), platform: seedPost.platform, url: seedPost.url ?? null, author: seedPost.author } : null,
    };
  },
});

// one-time per run: packed adjacency for client edge rendering
export const graph = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    acs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    return acs.map((c) => ({ flatAdj: c.flatAdj, offsets: c.offsets }));
  },
});

// flip estimates: silent children of this run, compared against the __control__ child
export const estimates = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const kids = (await ctx.db.query("runs")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect())
      .filter((r) => r.silent && r.parentRunId === runId);
    if (!kids.length) return null;
    // newest estimate batch only
    const latestTs = Math.max(...kids.map((k) => k._creationTime));
    const batch = kids.filter((k) => latestTs - k._creationTime < 60000);
    const rows = [];
    let controlOpp: number | null = null;
    for (const k of batch) {
      const values = await stancesAt(ctx, k._id, k.round);
      const t = tallyOf(values);
      if (k.label === "__control__") { controlOpp = t.opp; continue; }
      rows.push({ label: k.label, opp: t.opp, done: k.status === "complete" });
    }
    const allDone = batch.every((k) => k.status === "complete");
    return {
      allDone,
      rows: rows.map((r) => ({
        label: r.label,
        flips: controlOpp === null ? 0 : Math.max(0, controlOpp - r.opp),
        done: r.done,
      })).sort((a, b) => b.flips - a.flips),
    };
  },
});
