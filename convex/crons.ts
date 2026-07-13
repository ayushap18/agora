import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// decision monitoring: refresh corpus + re-run monitored decisions daily
crons.daily("refresh monitored decisions", { hourUTC: 6, minuteUTC: 0 }, internal.monitor.tick);
export default crons;
