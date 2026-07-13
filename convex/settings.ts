import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Single-row runtime settings. Secrets live in the LOCAL Convex DB — fine for
// a local demo deployment; the UI says so. Env vars remain the fallback.
export const save = mutation({
  args: {
    geminiKey: v.optional(v.string()),
    localUrl: v.optional(v.string()),
    localModel: v.optional(v.string()),
    hfToken: v.optional(v.string()),
    hfModel: v.optional(v.string()),
    rounds: v.optional(v.number()),
    tickMs: v.optional(v.number()),
    council: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const clean: Record<string, any> = {};
    for (const [k, val] of Object.entries(a)) {
      if (val === undefined) continue;
      clean[k] = typeof val === "string" && val.trim() === "" ? undefined : val;
    }
    if (clean.rounds !== undefined) clean.rounds = Math.max(6, Math.min(20, clean.rounds));
    if (clean.tickMs !== undefined) clean.tickMs = Math.max(300, Math.min(5000, clean.tickMs));
    const row = await ctx.db.query("settings").first();
    if (row) await ctx.db.patch(row._id, clean);
    else await ctx.db.insert("settings", clean);
  },
});

// masked view for the UI — secrets never round-trip to the browser
export const get = query({
  args: {},
  handler: async (ctx) => {
    const s = (await ctx.db.query("settings").first()) ?? ({} as any);
    const mask = (x?: string) => (x ? `saved · …${x.slice(-4)}` : null);
    return {
      geminiKey: mask(s.geminiKey ?? process.env.GEMINI_API_KEY),
      hfToken: mask(s.hfToken),
      localUrl: s.localUrl ?? process.env.LOCAL_LLM_URL ?? null,
      localModel: s.localModel ?? process.env.LOCAL_LLM_MODEL ?? null,
      hfModel: s.hfModel ?? null,
      rounds: s.rounds ?? 12,
      tickMs: s.tickMs ?? 1500,
      council: s.council ?? true,
    };
  },
});

export const getRaw = internalQuery({
  args: {},
  handler: async (ctx) => {
    const s = (await ctx.db.query("settings").first()) ?? ({} as any);
    return {
      geminiKey: s.geminiKey ?? process.env.GEMINI_API_KEY ?? null,
      localUrl: s.localUrl ?? process.env.LOCAL_LLM_URL ?? null,
      localModel: s.localModel ?? process.env.LOCAL_LLM_MODEL ?? "llama3.2",
      hfToken: s.hfToken ?? null,
      hfModel: s.hfModel ?? "meta-llama/Llama-3.1-8B-Instruct",
      rounds: s.rounds ?? 12,
      tickMs: s.tickMs ?? 1500,
      council: s.council ?? true,
    };
  },
});
