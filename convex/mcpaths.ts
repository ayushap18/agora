import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stepStances, tallyOf } from "./engine";
import { mulberry32 } from "./populate";

// Monte Carlo path simulator: K full replays of the run's dynamics, in memory,
// in one action — same stepStances math as the durable workflow, different
// noise seed per path. Output: K approval-percent trajectories (round 0..R).
export const simulate = action({
  args: { runId: v.id("runs"), samples: v.optional(v.number()) },
  handler: async (ctx, { runId, samples = 40 }): Promise<any> => {
    const K = Math.max(5, Math.min(80, samples));
    const w: any = await ctx.runQuery(internal.mcpaths.world, { runId });
    if (!w) return { error: "run not found or no data" };
    const paths: number[][] = [];
    for (let k = 0; k < K; k++) {
      const rng = mulberry32(w.seed + (k + 1) * 104729);
      let s = w.s0.slice();
      const path = [pct(tallyOf(s))];
      for (let r = 1; r <= w.rounds; r++) {
        s = stepStances(s, w.acs, w.cohortIdx, w.inf, w.stub, w.vol, w.names, w.fx, rng);
        path.push(pct(tallyOf(s)));
      }
      paths.push(path);
    }
    await ctx.runMutation(internal.mcpaths.store, { runId, samples: K, paths });
    return { samples: K, rounds: w.rounds };
  },
});

function pct(t: { sup: number; n: number }) {
  return Math.round((t.sup / t.n) * 1000) / 10;
}

export const world = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    pcs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    acs.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const s0rows = await ctx.db.query("stanceChunks")
      .withIndex("by_run_round", (q) => q.eq("runId", runId).eq("round", 0)).collect();
    s0rows.sort((a, b) => a.chunkIdx - b.chunkIdx);
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);
    if (!pcs.length || !s0rows.length) return null;
    return {
      seed: run.config.seed, rounds: run.config.rounds,
      fx: run.amendment?.fx ?? null,
      s0: s0rows.flatMap((c) => c.values),
      acs: acs.map((c) => ({ flatAdj: c.flatAdj, offsets: c.offsets })),
      cohortIdx: pcs.flatMap((c) => c.cohortIdx),
      inf: pcs.flatMap((c) => c.inf),
      stub: pcs.flatMap((c) => c.stub),
      vol: cohorts.map((c) => c.vol ?? 0.8),
      names: cohorts.map((c) => c.name),
    };
  },
});

export const store = internalMutation({
  args: { runId: v.id("runs"), samples: v.number(), paths: v.array(v.array(v.number())) },
  handler: async (ctx, { runId, samples, paths }) => {
    const old = await ctx.db.query("mcPaths").withIndex("by_run", (q) => q.eq("runId", runId)).first();
    if (old) await ctx.db.patch(old._id, { samples, paths });
    else await ctx.db.insert("mcPaths", { runId, samples, paths });
  },
});

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const doc = await ctx.db.query("mcPaths").withIndex("by_run", (q) => q.eq("runId", runId)).first();
    if (!doc) return null;
    const finals = doc.paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
    const q10 = finals[Math.floor(finals.length * 0.1)];
    const q90 = finals[Math.min(finals.length - 1, Math.floor(finals.length * 0.9))];
    return {
      samples: doc.samples, paths: doc.paths,
      lo: Math.round(finals[0]), hi: Math.round(finals[finals.length - 1]),
      p10: Math.round(q10), p90: Math.round(q90),
      mean: Math.round(finals.reduce((a, b) => a + b, 0) / finals.length),
    };
  },
});
