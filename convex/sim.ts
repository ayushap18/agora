import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const workflow = new WorkflowManager(components.workflow);

export const simulation = workflow.define({
  args: { runId: v.id("runs") },
  handler: async (step, { runId }): Promise<void> => {
    const run = await step.runQuery(internal.sim.getRun, { runId });
    const rounds = run.config.rounds;
    for (let r = run.round + 1; r <= rounds; r++) {
      const res: { round: number; done: boolean } = await step.runMutation(
        internal.engine.tickRound, { runId },
        run.silent ? {} : { runAfter: run.config.tickMs }
      );
      if (!run.silent) await step.runMutation(internal.voices.schedule, { runId, round: res.round });
      if (res.done) break;
    }
    await step.runMutation(internal.sim.markComplete, { runId });
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => (await ctx.db.get(runId))!,
});

export const markComplete = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = (await ctx.db.get(runId))!;
    await ctx.db.patch(runId, { status: "complete" });
    if (!run.silent) {
      await ctx.runMutation(internal.pipeline.log, {
        layer: "L4", status: "done", progress: 1, detail: `${run.label}: complete at round ${run.round}`, runId,
      });
      await ctx.db.insert("events", { runId, round: run.round, kind: "complete", payload: {} });
    }
  },
});

export const start = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = (await ctx.db.get(runId))!;
    if (run.status === "running") return;
    await ctx.db.patch(runId, { status: "running" });
    await workflow.start(ctx, internal.sim.simulation, { runId });
    if (!run.silent) {
      await ctx.runMutation(internal.pipeline.log, {
        layer: "L4", status: "running", progress: 0, detail: `${run.label}: workflow started`, runId,
      });
      await ctx.db.insert("events", { runId, round: run.round, kind: "start", payload: {} });
    }
  },
});

// Fork: fx computed over REAL distilled cohorts by amendment shape
export const fork = mutation({
  args: {
    runId: v.id("runs"),
    label: v.string(),
    mode: v.string(), // "grandfather" | "soften" | "compensate" | "custom"
  },
  handler: async (ctx, { runId, label, mode }) => {
    const run = (await ctx.db.get(runId))!;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q: any) => q.eq("decisionId", run.decisionId)).collect();
    cohorts.sort((a, b) => a.baseStance - b.baseStance); // most opposed first
    const fx: Record<string, number> = {};
    if (mode === "grandfather") {
      // full carve-out for the most opposed cohort, partial for the next
      if (cohorts[0]) fx[cohorts[0].name] = 0.95;
      if (cohorts[1]) fx[cohorts[1].name] = 0.3;
    } else if (mode === "soften") {
      for (const c of cohorts) if (c.baseStance < -0.1) fx[c.name] = 0.45;
    } else if (mode === "compensate") {
      const hurtC = cohorts.find((c) => c.hurt) ?? cohorts[0];
      if (hurtC) fx[hurtC.name] = 0.75;
      if (cohorts[1] && cohorts[1] !== hurtC) fx[cohorts[1].name] = 0.2;
    } else {
      for (const c of cohorts) if (c.baseStance < 0) fx[c.name] = 0.35;
    }
    const forkRunId = await ctx.db.insert("runs", {
      decisionId: run.decisionId, parentRunId: runId, forkedAtRound: run.round,
      label, status: "ready", round: 0, config: run.config,
      amendment: { label, fx }, silent: run.silent,
    });
    await ctx.runMutation(internal.engine.copyChunksForFork, { parentRunId: runId, forkRunId });
    await ctx.db.patch(forkRunId, { status: "running" });
    await workflow.start(ctx, internal.sim.simulation, { runId: forkRunId });
    if (!run.silent) {
      await ctx.db.insert("events", {
        runId, round: run.round, kind: "fork",
        payload: { label, forkRunId, fx },
      });
    }
    return forkRunId;
  },
});
