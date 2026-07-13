import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { mulberry32, CHUNK } from "./populate";

// Prototype-tuned constants (see spec Global Constraints)
const SOCIAL = 0.30, HARDEN = 0.045, AMEND_DIV = 4;
// Single source of tally truth — serve.ts and the UI use the same threshold.
export const STANCE_EPS = 0.12;
export function tallyOf(values: number[]) {
  let sup = 0, opp = 0;
  for (const s of values) { if (s > STANCE_EPS) sup++; else if (s < -STANCE_EPS) opp++; }
  return { sup, opp, neu: values.length - sup - opp, n: values.length };
}

async function loadRun(ctx: any, runId: any) {
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("run not found");
  const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q: any) => q.eq("runId", runId)).collect();
  const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q: any) => q.eq("runId", runId)).collect();
  pcs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
  acs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
  return { run, pcs, acs };
}

export async function loadStances(ctx: any, runId: any, round: number): Promise<number[]> {
  const scs = await ctx.db.query("stanceChunks")
    .withIndex("by_run_round", (q: any) => q.eq("runId", runId).eq("round", round)).collect();
  scs.sort((a: any, b: any) => a.chunkIdx - b.chunkIdx);
  return scs.flatMap((c: any) => c.values);
}

export const tickRound = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const { run, pcs, acs } = await loadRun(ctx, runId);
    if (run.status === "complete" || run.round >= run.config.rounds)
      return { round: run.round, done: true };
    const round = run.round + 1;
    const prev = await loadStances(ctx, runId, run.round);
    const n = prev.length;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q: any) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.idx - b.idx);

    // flatten persona attrs
    const cohortIdx = pcs.flatMap((c: any) => c.cohortIdx);
    const inf = pcs.flatMap((c: any) => c.inf);
    const stub = pcs.flatMap((c: any) => c.stub);
    const rng = mulberry32(run.config.seed + round * 7919);

    const next = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const chunk = acs[(i / CHUNK) | 0], local = i % CHUNK;
      const lo = chunk.offsets[local], hi = chunk.offsets[local + 1];
      let acc = 0, wsum = 0;
      for (let e = lo; e < hi; e++) {
        const j = chunk.flatAdj[e];
        // bounded confidence: distant opinions barely pull
        const w = inf[j] * Math.max(0.08, 1 - Math.abs(prev[j] - prev[i]) * 0.75);
        acc += w * (prev[j] - prev[i]); wsum += w;
      }
      const social = wsum ? (acc / wsum) * SOCIAL * (1 - stub[i]) : 0;
      const harden = HARDEN * Math.sign(prev[i]) * Math.abs(prev[i]);
      let shift = 0;
      const cName = cohorts[cohortIdx[i]]?.name;
      if (run.amendment && cName && run.amendment.fx[cName]) shift += run.amendment.fx[cName] / AMEND_DIV;
      const noise = (rng() - 0.5) * 0.05 * (cohorts[cohortIdx[i]]?.vol ?? 0.8);
      next[i] = Math.max(-1, Math.min(1, prev[i] + social + harden + shift + noise));
    }

    // write stance chunks + per-round stats + factions + run round
    for (let c = 0; c < pcs.length; c++) {
      const lo = c * CHUNK, hi = Math.min(n, lo + CHUNK);
      await ctx.db.insert("stanceChunks", {
        runId, round, chunkIdx: c, values: next.slice(lo, hi).map((s) => +s.toFixed(4)),
      });
    }
    await ctx.db.insert("roundStats", { runId, round, ...tallyOf(next) });
    if (round >= 3 && !run.silent) {
      const buckets: Record<string, { side: string; ci: number; n: number }> = {};
      for (let i = 0; i < n; i++) {
        const side = next[i] < -0.45 ? "opp" : next[i] > 0.45 ? "sup" : null;
        if (!side) continue;
        const key = side + ":" + cohortIdx[i];
        (buckets[key] = buckets[key] ?? { side, ci: cohortIdx[i], n: 0 }).n++;
      }
      const list = Object.values(buckets)
        .filter((f) => f.n >= Math.max(20, n * 0.011))
        .sort((a, b) => b.n - a.n).slice(0, 4)
        .map((f) => {
          const c = cohorts[f.ci];
          return {
            name: (f.side === "opp" ? c?.facOpp : c?.facSup) || c?.name || "Faction",
            n: f.n, side: f.side, arg: c?.tags[0] ?? "—",
          };
        });
      await ctx.db.insert("factions", { runId, round, list });
    }
    await ctx.db.patch(runId, { round });
    if (!run.silent) {
      await ctx.runMutation(internal.pipeline.log, {
        layer: "L4", status: "running", progress: round / run.config.rounds,
        detail: `${run.label}: round ${round}/${run.config.rounds}`, runId,
      });
    }
    return { round, done: round >= run.config.rounds };
  },
});

export const copyChunksForFork = internalMutation({
  args: { parentRunId: v.id("runs"), forkRunId: v.id("runs") },
  handler: async (ctx, { parentRunId, forkRunId }) => {
    const fork = (await ctx.db.get(forkRunId))!;
    const upTo = fork.forkedAtRound ?? 0;
    const pcs = await ctx.db.query("personaChunks").withIndex("by_run", (q: any) => q.eq("runId", parentRunId)).collect();
    for (const c of pcs) { const { _id, _creationTime, ...rest } = c as any; await ctx.db.insert("personaChunks", { ...rest, runId: forkRunId }); }
    const acs = await ctx.db.query("adjChunks").withIndex("by_run", (q: any) => q.eq("runId", parentRunId)).collect();
    for (const c of acs) { const { _id, _creationTime, ...rest } = c as any; await ctx.db.insert("adjChunks", { ...rest, runId: forkRunId }); }
    const scs = await ctx.db.query("stanceChunks").withIndex("by_run_round", (q: any) => q.eq("runId", parentRunId)).collect();
    for (const c of scs.filter((s: any) => s.round <= upTo)) {
      const { _id, _creationTime, ...rest } = c as any;
      await ctx.db.insert("stanceChunks", { ...rest, runId: forkRunId, round: rest.round });
    }
    await ctx.db.patch(forkRunId, { round: upTo });
  },
});
