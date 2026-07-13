import { query } from "./_generated/server";
import { v } from "convex/values";

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
