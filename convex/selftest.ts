import { action, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

// Model-accuracy harness: proves the engine's math invariants on demand.
//   npx convex run selftest:run
// Requires a distilled decision (cohorts) to exist. Cleans up after itself.
export const run = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const checks: { name: string; pass: boolean; detail?: string }[] = [];
    const ok = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail });

    const decisionId = await ctx.runQuery(internal.selftest.latestDistilledDecision, {});
    if (!decisionId) return { error: "no distilled decision — run distill first" };

    // two runs, same seed → must be bit-identical after 3 rounds (determinism)
    const a = await ctx.runMutation(api.populate.run, { decisionId, n: 200, seed: 4242 });
    const b = await ctx.runMutation(api.populate.run, { decisionId, n: 200, seed: 4242 });
    for (let r = 0; r < 3; r++) {
      await ctx.runMutation(internal.engine.tickRound, { runId: a });
      await ctx.runMutation(internal.engine.tickRound, { runId: b });
    }
    const sa: number[] = await ctx.runQuery(api.serve.roundStances, { runId: a, round: 3 });
    const sb: number[] = await ctx.runQuery(api.serve.roundStances, { runId: b, round: 3 });
    ok("determinism: same seed → identical stances after 3 rounds",
      sa.length === 200 && sa.length === sb.length && sa.every((v2, i) => v2 === sb[i]));
    ok("bounds: every stance in [-1, 1]", sa.every((v2) => v2 >= -1 && v2 <= 1));

    const tl: any[] = await ctx.runQuery(api.serve.timeline, { runId: a });
    ok("conservation: sup+neu+opp = n on every stored round",
      tl.length === 4 && tl.every((t) => t.sup + t.neu + t.opp === t.n),
      `${tl.length} rounds`);

    let sup = 0, opp = 0;
    for (const v2 of sa) { if (v2 > 0.12) sup++; else if (v2 < -0.12) opp++; }
    const last = tl.find((t) => t.round === 3);
    ok("stats integrity: stored roundStats equal recomputed tally",
      !!last && last.sup === sup && last.opp === opp,
      `stored ${last?.sup}/${last?.opp} vs recomputed ${sup}/${opp}`);

    // movement sanity: opinions actually move, but not explosively
    const s0: number[] = await ctx.runQuery(api.serve.roundStances, { runId: a, round: 0 });
    const drift = sa.reduce((acc, v2, i) => acc + Math.abs(v2 - s0[i]), 0) / sa.length;
    ok("dynamics: mean |Δstance| over 3 rounds in (0, 0.6)", drift > 0 && drift < 0.6,
      `mean drift ${drift.toFixed(3)}`);

    await ctx.runMutation(internal.sim.deleteRunCascade, { runId: a });
    await ctx.runMutation(internal.sim.deleteRunCascade, { runId: b });
    return { pass: checks.every((c) => c.pass), checks };
  },
});

export const latestDistilledDecision = internalQuery({
  args: {},
  handler: async (ctx) => {
    const decisions = await ctx.db.query("decisions").order("desc").take(10);
    for (const d of decisions) {
      const c = await ctx.db.query("cohorts")
        .withIndex("by_decision", (q) => q.eq("decisionId", d._id)).first();
      if (c) return d._id;
    }
    return null;
  },
});
