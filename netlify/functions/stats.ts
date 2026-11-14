import type { Config, Context } from "@netlify/functions";
import { getPool, getStats, type Queryable } from "../lib/db";
import { errorResponse, json } from "../lib/http";
import { errorKind, logEvent } from "../lib/log";
import { FixedWindowRateLimiter } from "../lib/rateLimit";

export interface StatsDeps {
  getDb: () => Queryable | null;
  limiter: FixedWindowRateLimiter;
}

export function createStatsHandler(deps: StatsDeps) {
  return async (_req: Request, context: Context): Promise<Response> => {
    if (!deps.limiter.allow(context.ip ?? "unknown")) {
      return errorResponse(429, "Too many requests. Please wait a minute and try again.");
    }

    const db = deps.getDb();
    if (!db) return errorResponse(500, "The database is not configured.");

    try {
      return json(200, await getStats(db));
    } catch (error) {
      logEvent("stats_error", errorKind(error));
      return errorResponse(500, "Could not load stats.");
    }
  };
}

export default createStatsHandler({
  getDb: getPool,
  limiter: new FixedWindowRateLimiter(60, 60_000),
});

export const config: Config = {
  path: "/api/stats",
  method: "GET",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
