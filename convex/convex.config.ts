import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(workflow);
app.use(workpool, { name: "voicesPool" });
app.use(rateLimiter);
export default app;
