/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as distill from "../distill.js";
import type * as engine from "../engine.js";
import type * as gemini from "../gemini.js";
import type * as ingest from "../ingest.js";
import type * as pipeline from "../pipeline.js";
import type * as populate from "../populate.js";
import type * as selftest from "../selftest.js";
import type * as serve from "../serve.js";
import type * as sim from "../sim.js";
import type * as voices from "../voices.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  distill: typeof distill;
  engine: typeof engine;
  gemini: typeof gemini;
  ingest: typeof ingest;
  pipeline: typeof pipeline;
  populate: typeof populate;
  selftest: typeof selftest;
  serve: typeof serve;
  sim: typeof sim;
  voices: typeof voices;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  voicesPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"voicesPool">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
