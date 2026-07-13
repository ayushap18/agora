import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getCfg } from "./llm";

// Embeddings: Gemini text-embedding-004 (768d) via the BYOK key, or an
// Ollama-compatible /api/embeddings endpoint. No provider → corpus stays
// unembedded and retrieval falls back to the random seedRef (never blocks).
async function embedBatch(cfg: any, texts: string[]): Promise<(number[] | null)[]> {
  if (cfg.geminiKey) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${cfg.geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: texts.map((t) => ({
            model: "models/text-embedding-004",
            content: { parts: [{ text: t.slice(0, 1500) }] },
          })),
        }),
      });
    if (!r.ok) return texts.map(() => null);
    const j = await r.json();
    return (j.embeddings ?? []).map((e: any) => e?.values ?? null);
  }
  if (cfg.localUrl) {
    const out: (number[] | null)[] = [];
    for (const t of texts) {
      const r = await fetch(`${cfg.localUrl.replace(/\/$/, "")}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.localModel, prompt: t.slice(0, 1500) }),
      }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      // pad/trim to the index's 768 dims so mixed providers can't corrupt it
      const e = j?.embedding as number[] | undefined;
      out.push(e ? e.slice(0, 768).concat(new Array(Math.max(0, 768 - e.length)).fill(0)) : null);
    }
    return out;
  }
  return texts.map(() => null);
}

export async function embedOne(cfg: any, text: string): Promise<number[] | null> {
  return (await embedBatch(cfg, [text]))[0];
}

// L1.5 — embed the cohort-assigned corpus after distill (batches of 80)
export const corpus = internalAction({
  args: {},
  handler: async (ctx) => {
    const cfg = await getCfg(ctx);
    if (!cfg.geminiKey && !cfg.localUrl) {
      await ctx.runMutation(internal.pipeline.log, {
        layer: "L1.5", status: "done", progress: 1,
        detail: "embeddings skipped — no model key (retrieval falls back)",
      });
      return { embedded: 0 };
    }
    const posts: any[] = await ctx.runQuery(internal.embed.unembedded, {});
    let done = 0;
    for (let lo = 0; lo < posts.length; lo += 80) {
      const batch = posts.slice(lo, lo + 80);
      const vecs = await embedBatch(cfg, batch.map((p) => p.text));
      const rows = batch.map((p, i) => ({ id: p._id, embedding: vecs[i] }))
        .filter((r) => r.embedding);
      if (rows.length) await ctx.runMutation(internal.embed.store, { rows });
      done += rows.length;
      await ctx.runMutation(internal.pipeline.log, {
        layer: "L1.5", status: "running", progress: Math.min(1, (lo + 80) / posts.length),
        detail: `embedding corpus: ${done}/${posts.length}`,
      });
    }
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L1.5", status: "done", progress: 1, detail: `${done} posts embedded (768d)`,
    });
    return { embedded: done };
  },
});

export const unembedded = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("posts").order("desc").take(600))
      .filter((p) => p.cohortIdx !== undefined && !p.embedding)
      .slice(0, 400)
      .map((p) => ({ _id: p._id, text: p.text })),
});

export const store = internalMutation({
  args: { rows: v.array(v.object({ id: v.id("posts"), embedding: v.array(v.float64()) })) },
  handler: async (ctx, { rows }) => {
    for (const r of rows) await ctx.db.patch(r.id, { embedding: r.embedding });
  },
});
