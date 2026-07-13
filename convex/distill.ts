import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { llmJson } from "./llm";

// ── decision seeding (called from UI before distill) ──────────────────────
export const seedDecision = mutation({
  args: {
    title: v.string(), body: v.string(),
    amendments: v.array(v.object({ label: v.string(), detail: v.string(), fx: v.record(v.string(), v.number()) })),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("decisions").take(50);
    const dup = existing.find((d) => d.title === a.title);
    if (dup) return dup._id;
    return await ctx.db.insert("decisions", { ...a, status: "draft" });
  },
});

export const listCohorts = query({
  args: { decisionId: v.id("decisions") },
  handler: async (ctx, { decisionId }) =>
    await ctx.db.query("cohorts").withIndex("by_decision", (q) => q.eq("decisionId", decisionId)).collect(),
});

export const getPosts = internalQuery({
  args: { sinceTs: v.optional(v.number()) },
  handler: async (ctx, { sinceTs }) => {
    // scope to this session's fetches so a multi-topic corpus can't blend
    // unrelated posts into the cohorts; fall back to the full corpus
    if (sinceTs) {
      const fresh = (await ctx.db.query("posts").order("desc").take(600))
        .filter((p) => p._creationTime >= sinceTs);
      if (fresh.length >= 10) return fresh.slice(0, 400);
    }
    return await ctx.db.query("posts").order("desc").take(400);
  },
});

export const writeCohorts = internalMutation({
  args: { decisionId: v.id("decisions"), cohorts: v.array(v.any()), postAssign: v.array(v.any()) },
  handler: async (ctx, { decisionId, cohorts, postAssign }) => {
    // replace previous distill output for this decision
    const old = await ctx.db.query("cohorts").withIndex("by_decision", (q) => q.eq("decisionId", decisionId)).collect();
    for (const c of old) await ctx.db.delete(c._id);
    for (const c of cohorts) await ctx.db.insert("cohorts", { decisionId, ...c });
    for (const pa of postAssign) await ctx.db.patch(pa.postId, { cohortIdx: pa.cohortIdx, tags: pa.tags });
    await ctx.runMutation(internal.pipeline.log, {
      layer: "L1", status: "done", progress: 1,
      detail: `${cohorts.length} cohorts distilled from corpus`,
    });
  },
});

// ── L1 distill ─────────────────────────────────────────────────────────────
const OPP_WORDS = ["hate","forced","forcing","unfair","quit","quitting","against","worse","stupid","refuse","gut","theater","waste","insulting","betrayal","exhausted","surveillance","cost","expensive","punish"];
const SUP_WORDS = ["agree","support","better","good","love","great","mentorship","together","collaboration","culture","fair","necessary","productive","glad","improve"];

function sentiment(text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of OPP_WORDS) if (t.includes(w)) s -= 1;
  for (const w of SUP_WORDS) if (t.includes(w)) s += 1;
  return Math.max(-1, Math.min(1, s / 3));
}

export const run = action({
  args: { decisionId: v.id("decisions"), sinceTs: v.optional(v.number()) },
  handler: async (ctx, { decisionId, sinceTs }) => {
    await ctx.runMutation(internal.pipeline.log, { layer: "L1", status: "running", progress: 0.1, detail: "reading corpus…" });
    const posts: any[] = await ctx.runQuery(internal.distill.getPosts, { sinceTs });
    if (posts.length < 10) {
      await ctx.runMutation(internal.pipeline.log, { layer: "L1", status: "failed", progress: 0, detail: "corpus too small — fetch sources first" });
      return { cohortCount: 0 };
    }
    const decision = await ctx.runQuery(internal.distill.getDecision, { decisionId });

    // ── Gemini path ──
    const snippets = posts.slice(0, 120).map((p, i) => `[${i}] (${p.platform}, ▲${p.score}) ${p.text.slice(0, 220)}`).join("\n");
    const g = await llmJson(ctx,
`You are analyzing real social-media reactions to this decision:
"${decision.title} — ${decision.body}"

Below are real posts. Cluster the AUTHORS into 6-8 stakeholder cohorts.
For each cohort return:
- name (evocative, 2-4 words, e.g. "Remote-hired engineers")
- share (fraction of population, all shares sum to 1)
- baseStance (-1 strongly opposed .. +1 strongly supportive)
- vol (0.5-1.1 opinion volatility), infMult (0.5-1.5 network influence)
- tags (3 short argument tags)
- seedQuotes: {o:[3 oppose-flavored quotes], n:[2 neutral], s:[2 support]} — paraphrase REAL posts below, max 140 chars each
- facOpp / facSup (faction names if this cohort radicalizes either way)
- hurt (only for ONE structurally voiceless cohort: one sentence on how this decision quietly harms them; others omit)
- postIdx (array of post indices [..] from below that belong to this cohort)

POSTS:
${snippets}

Return JSON: {"cohorts":[...]}`);

    let cohorts: any[] = [];
    let postAssign: any[] = [];
    if (g?.cohorts?.length >= 4) {
      await ctx.runMutation(internal.pipeline.log, { layer: "L1", status: "running", progress: 0.7, detail: "gemini clustered corpus — normalizing" });
      const totalShare = g.cohorts.reduce((a: number, c: any) => a + (c.share || 0), 0) || 1;
      cohorts = g.cohorts.slice(0, 8).map((c: any, idx: number) => ({
        idx, name: String(c.name ?? `Cohort ${idx + 1}`).slice(0, 40),
        share: (c.share || 0.12) / totalShare,
        baseStance: Math.max(-1, Math.min(1, c.baseStance ?? 0)),
        vol: Math.max(0.4, Math.min(1.2, c.vol ?? 0.8)),
        infMult: Math.max(0.4, Math.min(1.6, c.infMult ?? 1)),
        tags: (c.tags ?? ["general"]).slice(0, 3).map(String),
        seedQuotes: {
          o: (c.seedQuotes?.o ?? []).slice(0, 3).map((q: string) => q.slice(0, 140)),
          n: (c.seedQuotes?.n ?? []).slice(0, 2).map((q: string) => q.slice(0, 140)),
          s: (c.seedQuotes?.s ?? []).slice(0, 2).map((q: string) => q.slice(0, 140)),
        },
        facOpp: String(c.facOpp ?? c.name), facSup: String(c.facSup ?? c.name),
        hurt: c.hurt ? String(c.hurt) : undefined,
        postIds: (c.postIdx ?? []).filter((i: number) => posts[i]).slice(0, 40).map((i: number) => posts[i]._id),
      }));
      g.cohorts.forEach((c: any, ci: number) =>
        (c.postIdx ?? []).filter((i: number) => posts[i]).forEach((i: number) =>
          postAssign.push({ postId: posts[i]._id, cohortIdx: ci, tags: (c.tags ?? []).slice(0, 3) })));
    } else {
      // ── fallback path: sentiment × platform buckets, quotes from real posts ──
      await ctx.runMutation(internal.pipeline.log, { layer: "L1", status: "running", progress: 0.5, detail: "no gemini — keyword clustering corpus" });
      const buckets: Record<string, any[]> = {};
      for (const p of posts) {
        const s = sentiment(p.text);
        const key = (s < -0.15 ? "opp" : s > 0.15 ? "sup" : "neu") + ":" + (["reddit","lemmy","hn"].includes(p.platform) ? "forum" : "social");
        (buckets[key] = buckets[key] ?? []).push(p);
      }
      const DEFS: [string, string, number, string, string][] = [
        ["opp:forum", "Forum Hardliners", -0.7, "The Refusal Bloc", "Grudging Returners"],
        ["opp:social", "Feed Dissenters", -0.55, "The Walkout Wing", "Softened Critics"],
        ["neu:forum", "Pragmatic Posters", -0.05, "Tired Moderates", "Quiet Adopters"],
        ["neu:social", "Undecided Scrollers", 0.05, "Skeptical Middle", "Warmed-up Middle"],
        ["sup:forum", "Structured Supporters", 0.55, "Disillusioned Backers", "The Mandate Caucus"],
        ["sup:social", "Feed Champions", 0.65, "Quiet Doubters", "The Cheer Squad"],
      ];
      const total = posts.length;
      cohorts = DEFS.filter(([k]) => (buckets[k] ?? []).length >= 5).map(([k, name, base, facOpp, facSup], idx) => {
        const ps = buckets[k];
        const quotes = ps.slice(0, 12).map((p) => p.text.slice(0, 140));
        return {
          idx, name, share: ps.length / total, baseStance: base,
          vol: 0.8, infMult: k.includes("forum") ? 1.2 : 0.9,
          tags: [k.startsWith("opp") ? "opposition" : k.startsWith("sup") ? "support" : "undecided", k.split(":")[1]],
          seedQuotes: { o: quotes.slice(0, 3), n: quotes.slice(3, 5), s: quotes.slice(5, 7) },
          facOpp, facSup,
          hurt: idx === 0 ? "Loudest in forums, least represented where the decision is actually made." : undefined,
          postIds: ps.slice(0, 40).map((p) => p._id),
        };
      });
      cohorts.forEach((c, ci) => {
        const ps = buckets[DEFS.filter(([k]) => (buckets[k] ?? []).length >= 5)[ci][0]];
        ps.forEach((p) => postAssign.push({ postId: p._id, cohortIdx: ci, tags: c.tags }));
      });
    }

    await ctx.runMutation(internal.distill.writeCohorts, { decisionId, cohorts, postAssign: postAssign.slice(0, 380) });
    return { cohortCount: cohorts.length };
  },
});

export const getDecision = internalQuery({
  args: { decisionId: v.id("decisions") },
  handler: async (ctx, { decisionId }) => (await ctx.db.get(decisionId))!,
});
