import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

export const setMonitor = mutation({
  args: { decisionId: v.id("decisions"), on: v.boolean(), query: v.optional(v.string()) },
  handler: async (ctx, { decisionId, on, query }) => {
    await ctx.db.patch(decisionId, { monitor: on, ...(query ? { query } : {}) });
  },
});

export const monitored = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("decisions").collect()).filter((d) => d.monitor),
});

// daily: fresh posts → re-distill → new run. fail-soft per decision.
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const ds: any[] = await ctx.runQuery(internal.monitor.monitored, {});
    for (const d of ds) {
      const q = d.query ?? d.title;
      const since = Date.now();
      for (const platform of ["reddit", "hn", "bluesky"]) {
        try { await ctx.runMutation(api.ingest.start, { platform, query: q }); } catch {}
      }
      // let fetches land, then rebuild the pipeline for this decision
      await ctx.scheduler.runAfter(60000, internal.monitor.rebuild, { decisionId: d._id, since });
    }
  },
});

export const rebuild = internalAction({
  args: { decisionId: v.id("decisions"), since: v.number() },
  handler: async (ctx, { decisionId, since }) => {
    try {
      await ctx.runAction(api.distill.run, { decisionId, sinceTs: since });
      const runId: any = await ctx.runMutation(api.populate.run, { decisionId, n: 800 });
      await ctx.runMutation(api.sim.start, { runId });
    } catch (e) { console.error("monitor rebuild failed", e); }
  },
});

// drift series: approval% of completed baselines over time (the monitoring chart)
export const series = query({
  args: { decisionId: v.id("decisions") },
  handler: async (ctx, { decisionId }) => {
    const runs = (await ctx.db.query("runs")
      .withIndex("by_decision", (q) => q.eq("decisionId", decisionId)).collect())
      .filter((r) => !r.silent && !r.parentRunId && r.status === "complete")
      .sort((a, b) => a._creationTime - b._creationTime);
    const out = [];
    for (const r of runs) {
      const st = await ctx.db.query("roundStats")
        .withIndex("by_run", (q) => q.eq("runId", r._id).eq("round", r.round)).first();
      if (st) out.push({ ts: r._creationTime, pct: Math.round((st.sup / st.n) * 100) });
    }
    return out;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("decisions").collect())
      .filter((d) => d.monitor).map((d) => ({ _id: d._id, title: d.title })),
});
