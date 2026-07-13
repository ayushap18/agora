import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { cascadeDelete } from "./sim";

// Workspace retention: keeps the latest non-silent baseline per decision plus
// its non-silent forks; everything else (stale test runs, consumed silent
// estimates, failed sources, orphan child rows, duplicate posts) is removed.
//   npx convex run ops:cleanup      — or the dashboard's "Clean workspace"
export const cleanup = mutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").collect();
    const keep = new Set<string>();
    const byDecision: Record<string, any[]> = {};
    for (const r of runs) {
      if (r.silent) continue;
      (byDecision[r.decisionId] = byDecision[r.decisionId] ?? []).push(r);
    }
    for (const group of Object.values(byDecision)) {
      const baselines = group.filter((r) => !r.parentRunId).sort((a, b) => b._creationTime - a._creationTime);
      if (!baselines.length) continue;
      keep.add(baselines[0]._id);
      for (const r of group) if (r.parentRunId === baselines[0]._id) keep.add(r._id);
    }
    // chunk data is heavy: stay far under the 16MB/txn read limit by deleting
    // at most 4 runs per invocation and rescheduling ourselves for the rest
    let deletedRuns = 0;
    const doomed = runs.filter((r) => !keep.has(r._id));
    for (const r of doomed.slice(0, 4)) {
      await cascadeDelete(ctx, r._id);
      deletedRuns++;
    }
    if (doomed.length > 4) {
      await ctx.scheduler.runAfter(0, api.ops.cleanup, {});
      return { deletedRuns, remaining: doomed.length - 4, rescheduled: true };
    }
    // orphan child rows (runs deleted before the cascade covered every table)
    const liveRunIds = new Set((await ctx.db.query("runs").collect()).map((r) => r._id as string));
    let orphans = 0;
    for (const table of ["factions", "voices", "events", "roundStats"] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        if (!liveRunIds.has(row.runId as string)) { await ctx.db.delete(row._id); orphans++; }
      }
    }
    // failed sources are dead weight
    let deadSources = 0;
    for (const src of await ctx.db.query("sources").collect()) {
      if (src.status === "failed") { await ctx.db.delete(src._id); deadSources++; }
    }
    // legacy duplicate posts (pre-dedupe rows have no hash; keep first of each text)
    const posts = await ctx.db.query("posts").collect();
    const seen = new Set<string>();
    let dupPosts = 0;
    for (const p of posts.sort((a, b) => a._creationTime - b._creationTime)) {
      const key = p.text.toLowerCase().replace(/\s+/g, " ").trim();
      const words = p.text.replace(/https?:\/\/\S+/g, "").trim().split(/\s+/).filter(Boolean);
      if (seen.has(key) || words.length < 5) { await ctx.db.delete(p._id); dupPosts++; }
      else seen.add(key);
    }
    return { deletedRuns, keptRuns: keep.size, orphans, deadSources, dupJunkPosts: dupPosts };
  },
});

export const workspaceStats = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("runs").collect();
    const posts = await ctx.db.query("posts").take(5000);
    const sources = await ctx.db.query("sources").order("desc").take(8);
    const decisions = await ctx.db.query("decisions").collect();
    return {
      posts: posts.length,
      decisions: decisions.length,
      runs: runs.filter((r) => !r.silent).length,
      silentRuns: runs.filter((r) => r.silent).length,
      completeRuns: runs.filter((r) => !r.silent && r.status === "complete").length,
      sources: sources.map((s) => ({ platform: s.platform, status: s.status, count: s.count })),
    };
  },
});

export const recentRuns = query({
  args: {},
  handler: async (ctx) => {
    const runs = (await ctx.db.query("runs").order("desc").take(30))
      .filter((r) => !r.silent).slice(0, 8);
    const out = [];
    for (const r of runs) {
      const d = await ctx.db.get(r.decisionId);
      out.push({
        _id: r._id, label: r.label, status: r.status, round: r.round,
        rounds: r.config.rounds, n: r.config.n, title: d?.title ?? "—",
        forked: !!r.parentRunId, ts: r._creationTime,
      });
    }
    return out;
  },
});
