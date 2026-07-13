import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// Prefer the build-time env var; fall back to the prod cloud deployment so the
// hosted site works even if VITE_CONVEX_URL isn't configured. Convex URLs are
// public by design (function-level auth guards writes). Override via env for
// local dev or a different deployment.
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || "https://watchful-horse-414.convex.cloud";
export const client = new ConvexClient(CONVEX_URL);
export { api };
