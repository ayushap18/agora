import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const log = internalMutation({
  args: {
    layer: v.string(),
    status: v.string(),
    progress: v.number(),
    detail: v.string(),
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("pipeline", { ...a, ts: Date.now() });
    // cap history so the table never grows unbounded
    const old = await ctx.db.query("pipeline").order("asc").take(1000);
    if (old.length >= 400) {
      for (const row of old.slice(0, old.length - 300)) await ctx.db.delete(row._id);
    }
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("pipeline").order("desc").take(80);
    const byLayer: Record<string, (typeof rows)[0]> = {};
    for (const r of rows) if (!byLayer[r.layer]) byLayer[r.layer] = r;
    return Object.values(byLayer).sort((a, b) => a.layer.localeCompare(b.layer));
  },
});
