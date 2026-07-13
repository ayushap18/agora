import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ponytail: hand-rolled presence — heartbeat upsert + stale sweep, no component
export const heartbeat = mutation({
  args: { runId: v.id("runs"), clientId: v.string(), name: v.string(), x: v.number(), y: v.number() },
  handler: async (ctx, a) => {
    const rows = await ctx.db.query("presence").withIndex("by_run", (q) => q.eq("runId", a.runId)).collect();
    const mine = rows.find((r) => r.clientId === a.clientId);
    const now = Date.now();
    if (mine) await ctx.db.patch(mine._id, { x: a.x, y: a.y, ts: now, name: a.name });
    else await ctx.db.insert("presence", { ...a, ts: now });
    for (const r of rows) if (now - r.ts > 300000) await ctx.db.delete(r._id);
  },
});

export const viewers = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    return (await ctx.db.query("presence").withIndex("by_run", (q) => q.eq("runId", runId)).collect())
      .filter((r) => now - r.ts < 90000) // background tabs beat ~1/min (browser throttling)
      .map((r) => ({ clientId: r.clientId, name: r.name, x: r.x, y: r.y }));
  },
});
