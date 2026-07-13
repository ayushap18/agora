import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  decisions: defineTable({
    title: v.string(),
    body: v.string(),
    status: v.string(),
    amendments: v.array(
      v.object({ label: v.string(), detail: v.string(), fx: v.record(v.string(), v.number()) })
    ),
  }),
  sources: defineTable({
    platform: v.string(),
    query: v.string(),
    status: v.string(), // pending|running|done|failed
    count: v.number(),
    error: v.optional(v.string()),
  }),
  posts: defineTable({
    sourceId: v.id("sources"),
    platform: v.string(),
    author: v.string(),
    text: v.string(),
    score: v.number(),
    url: v.optional(v.string()),
    ts: v.number(),
    tags: v.optional(v.array(v.string())),
    cohortIdx: v.optional(v.number()),
  }).index("by_source", ["sourceId"]),
  cohorts: defineTable({
    decisionId: v.id("decisions"),
    idx: v.number(),
    name: v.string(),
    share: v.number(),
    baseStance: v.number(),
    vol: v.number(),
    infMult: v.number(),
    tags: v.array(v.string()),
    seedQuotes: v.object({
      o: v.array(v.string()),
      n: v.array(v.string()),
      s: v.array(v.string()),
    }),
    facOpp: v.string(),
    facSup: v.string(),
    hurt: v.optional(v.string()),
    postIds: v.array(v.id("posts")),
  }).index("by_decision", ["decisionId"]),
  runs: defineTable({
    decisionId: v.id("decisions"),
    parentRunId: v.optional(v.id("runs")),
    forkedAtRound: v.optional(v.number()),
    label: v.string(),
    status: v.string(), // ready|running|complete|failed
    round: v.number(),
    config: v.object({
      n: v.number(),
      rounds: v.number(),
      seed: v.number(),
      tickMs: v.number(),
    }),
    amendment: v.optional(
      v.object({ label: v.string(), fx: v.record(v.string(), v.number()) })
    ),
    silent: v.optional(v.boolean()),
  }).index("by_decision", ["decisionId"]),
  personaChunks: defineTable({
    runId: v.id("runs"),
    chunkIdx: v.number(),
    names: v.array(v.string()),
    cohortIdx: v.array(v.number()),
    inf: v.array(v.number()),
    stub: v.array(v.number()),
    seedRef: v.array(v.union(v.id("posts"), v.null())),
  }).index("by_run", ["runId", "chunkIdx"]),
  adjChunks: defineTable({
    runId: v.id("runs"),
    chunkIdx: v.number(),
    flatAdj: v.array(v.number()),
    offsets: v.array(v.number()),
  }).index("by_run", ["runId", "chunkIdx"]),
  stanceChunks: defineTable({
    runId: v.id("runs"),
    round: v.number(),
    chunkIdx: v.number(),
    values: v.array(v.number()),
  }).index("by_run_round", ["runId", "round", "chunkIdx"]),
  voices: defineTable({
    runId: v.id("runs"),
    round: v.number(),
    personaIdx: v.number(),
    name: v.string(),
    cohort: v.string(),
    stance: v.number(),
    text: v.string(),
    kind: v.string(), // quote|dissent|synthesis
    sourceUrl: v.optional(v.string()),
  }).index("by_run", ["runId", "round"]),
  factions: defineTable({
    runId: v.id("runs"),
    round: v.number(),
    list: v.array(
      v.object({ name: v.string(), n: v.number(), side: v.string(), arg: v.string() })
    ),
  }).index("by_run", ["runId", "round"]),
  events: defineTable({
    runId: v.id("runs"),
    round: v.number(),
    kind: v.string(),
    payload: v.any(),
  }).index("by_run", ["runId"]),
  pipeline: defineTable({
    runId: v.optional(v.id("runs")),
    layer: v.string(),
    status: v.string(),
    progress: v.number(),
    detail: v.string(),
    ts: v.number(),
  }).index("by_layer", ["layer"]),
});
