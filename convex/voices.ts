import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// stub — becomes the Workpool + Gemini voices layer in the L5 task
export const schedule = internalMutation({
  args: { runId: v.id("runs"), round: v.number() },
  handler: async () => {},
});
