import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export const client = new ConvexClient(import.meta.env.VITE_CONVEX_URL);
export { api };
