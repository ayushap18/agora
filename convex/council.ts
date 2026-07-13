import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCfg, localJson, geminiJson, hfJson, tiersOf } from "./llm";

// MODEL COUNCIL — every configured model independently predicts the final
// approval% from the ROUND-0 cohort brief; the engine's simulated outcome is
// ground truth. accuracy = 100 − |prediction − actual|. Results persist as an
// `events` row (kind "council") so re-opening the verdict is instant.
export const run = action({
  args: { runId: v.id("runs"), force: v.optional(v.boolean()) },
  handler: async (ctx, { runId, force }): Promise<any> => {
    const cached: any = await ctx.runQuery(internal.council.cached, { runId });
    if (cached && !force) return cached;

    const brief: any = await ctx.runQuery(internal.council.brief, { runId });
    if (!brief) return { error: "run not found or not complete" };
    const cfg = await getCfg(ctx);
    const tiers = tiersOf(cfg);
    if (!tiers.length) return { rows: [], actual: brief.actual, note: "no models configured — add keys in Settings" };

    const prompt =
`A ${brief.n}-persona population debates: "${brief.title}".
Round-0 cohorts (name, share of population, mean starting stance -1..1):
${brief.cohorts.map((c: any) => `- ${c.name}: ${(c.share * 100).toFixed(0)}%, stance ${c.baseStance.toFixed(2)}`).join("\n")}
Opinions spread over ${brief.rounds} rounds of social-network influence (bounded
confidence, conviction hardening). Predict the FINAL percentage of the population
that SUPPORTS (stance > 0.12) after round ${brief.rounds}.
Return JSON: {"approvalPct": <0-100 number>, "reason": "<one sentence>"}`;

    const callers: Record<string, (p: string) => Promise<any>> = {
      local: (p) => localJson(cfg, p),
      gemini: (p) => geminiJson(cfg, p),
      hf: (p) => hfJson(cfg, p),
    };
    const rows = (await Promise.all(tiers.map(async (t) => {
      const g = await callers[t.id](prompt);
      const pred = Number(g?.approvalPct);
      if (!Number.isFinite(pred)) return { model: t.label, ok: false as const };
      return {
        model: t.label, ok: true as const,
        prediction: Math.max(0, Math.min(100, Math.round(pred))),
        reason: String(g?.reason ?? "").slice(0, 160),
      };
    })));
    const good = rows.filter((r: any) => r.ok).map((r: any) => ({
      ...r,
      error: Math.abs(r.prediction - brief.actual),
      accuracy: Math.max(0, 100 - Math.abs(r.prediction - brief.actual)),
    }));
    const result = {
      actual: brief.actual,
      consensus: good.length ? Math.round(good.reduce((a: number, r: any) => a + r.prediction, 0) / good.length) : null,
      rows: good.sort((a: any, b: any) => b.accuracy - a.accuracy),
      skipped: rows.filter((r: any) => !r.ok).map((r: any) => r.model),
    };
    await ctx.runMutation(internal.council.persist, { runId, result });
    return result;
  },
});

export const cached = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const evs = await ctx.db.query("events").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    return evs.find((e) => e.kind === "council")?.payload ?? null;
  },
});

export const persist = internalMutation({
  args: { runId: v.id("runs"), result: v.any() },
  handler: async (ctx, { runId, result }) => {
    const run = (await ctx.db.get(runId))!;
    const evs = await ctx.db.query("events").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
    const old = evs.find((e) => e.kind === "council");
    if (old) await ctx.db.patch(old._id, { payload: result });
    else await ctx.db.insert("events", { runId, round: run.round, kind: "council", payload: result });
  },
});

export const brief = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const decision = (await ctx.db.get(run.decisionId))!;
    const cohorts = await ctx.db.query("cohorts")
      .withIndex("by_decision", (q) => q.eq("decisionId", run.decisionId)).collect();
    const stats = await ctx.db.query("roundStats")
      .withIndex("by_run", (q) => q.eq("runId", runId).eq("round", run.round)).first();
    if (!stats) return null;
    return {
      title: decision.title, n: run.config.n, rounds: run.config.rounds,
      cohorts: cohorts.sort((a, b) => a.idx - b.idx)
        .map((c) => ({ name: c.name, share: c.share, baseStance: c.baseStance })),
      actual: Math.round((stats.sup / stats.n) * 100),
    };
  },
});
