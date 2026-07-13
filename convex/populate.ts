import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const CHUNK = 500;

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Maya","Arjun","Lena","Tomás","Priya","Jonas","Aisha","Derek","Sofia","Kenji","Nadia","Marcus","Ingrid","Ravi","Chloe","Omar","Tessa","Felix","Zara","Ivan","Amara","Noel","Yuki","Dana","Silas","Rhea","Colin","Fatima","Emil","Josie","Anders","Lila"];
const LAST = ["Okafor","Lindqvist","Reyes","Tanaka","Novak","Mehta","Boateng","Kowalski","Ferreira","Haddad","Ström","Iyer","Marchetti","Osei","Byrne","Vargas","Klein","Ahmadi","Dubois","Nakamura","Petrov","Ortiz","Werner","Chowdhury","Eze","Halvorsen","Rossi","Sato","Nkemelu","Bianchi","Farrell","Kaur"];

export const run = mutation({
  args: {
    decisionId: v.id("decisions"),
    n: v.optional(v.number()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, { decisionId, n = 1800, seed }) => {
    const cohorts = await ctx.db
      .query("cohorts").withIndex("by_decision", (q) => q.eq("decisionId", decisionId)).collect();
    if (!cohorts.length) throw new Error("no cohorts — run distill first");
    cohorts.sort((a, b) => a.idx - b.idx);
    const theSeed = seed ?? (Date.now() % 2147483647);
    const rng = mulberry32(theSeed);
    n = Math.max(200, Math.min(2000, n));

    const runId = await ctx.db.insert("runs", {
      decisionId, label: "baseline", status: "ready", round: 0,
      config: { n, rounds: 12, seed: theSeed, tickMs: 1500 },
    });
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L2", status: "running", progress: 0.2, detail: `synthesizing ${n} personas…`, runId,
    });

    // cohort assignment by share (deterministic)
    const pool: number[] = [];
    cohorts.forEach((c, ci) => {
      const count = Math.round(c.share * n);
      for (let i = 0; i < count; i++) pool.push(ci);
    });
    while (pool.length < n) pool.push(0);
    pool.length = n;

    // personas
    const names: string[] = [], cohortIdx: number[] = [], inf: number[] = [],
      stub: number[] = [], stance: number[] = [], seedRef: (string | null)[] = [];
    for (let i = 0; i < n; i++) {
      const ci = pool[i], c = cohorts[ci];
      names.push(FIRST[(rng() * FIRST.length) | 0] + " " + LAST[(rng() * LAST.length) | 0]);
      cohortIdx.push(ci);
      stance.push(Math.max(-1, Math.min(1, c.baseStance + (rng() - 0.5) * 0.55)));
      stub.push(0.25 + rng() * 0.5);
      inf.push((rng() < 0.08 ? 1.6 : 0.4) + rng() * 0.6 * c.infMult);
      seedRef.push(c.postIds.length ? (c.postIds[(rng() * c.postIds.length) | 0] as string) : null);
    }

    // social graph: 68% intra-cohort, influencers reach further
    const byCohort: number[][] = cohorts.map(() => []);
    for (let i = 0; i < n; i++) byCohort[cohortIdx[i]].push(i);
    const adj: number[][] = [];
    for (let i = 0; i < n; i++) {
      const k = 2 + ((rng() * 3) | 0) + (inf[i] > 1.4 ? 3 : 0);
      const nb = new Set<number>();
      let guard = 0;
      while (nb.size < k && guard++ < 60) {
        let j: number;
        if (rng() < 0.68) {
          const mates = byCohort[cohortIdx[i]];
          j = mates[(rng() * mates.length) | 0];
        } else j = (rng() * n) | 0;
        if (j !== i) nb.add(j);
      }
      adj.push([...nb]);
    }

    // write chunks
    const chunks = Math.ceil(n / CHUNK);
    let edgeCount = 0;
    for (let c = 0; c < chunks; c++) {
      const lo = c * CHUNK, hi = Math.min(n, lo + CHUNK);
      await ctx.db.insert("personaChunks", {
        runId, chunkIdx: c,
        names: names.slice(lo, hi), cohortIdx: cohortIdx.slice(lo, hi),
        inf: inf.slice(lo, hi), stub: stub.slice(lo, hi),
        seedRef: seedRef.slice(lo, hi) as any,
      });
      const flatAdj: number[] = [], offsets: number[] = [0];
      for (let i = lo; i < hi; i++) { flatAdj.push(...adj[i]); offsets.push(flatAdj.length); }
      edgeCount += flatAdj.length;
      await ctx.db.insert("adjChunks", { runId, chunkIdx: c, flatAdj, offsets });
      await ctx.db.insert("stanceChunks", {
        runId, round: 0, chunkIdx: c, values: stance.slice(lo, hi).map((s) => +s.toFixed(4)),
      });
    }
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L2", status: "done", progress: 1, detail: `${n} personas in ${chunks} chunks`, runId,
    });
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L3", status: "done", progress: 1, detail: `graph: ${edgeCount} directed edges`, runId,
    });
    return runId;
  },
});
