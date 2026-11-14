import type { Config, Context } from "@netlify/functions";
import { FeedbackRequestSchema } from "../../lib/schema";
import { getPool, setFeedback, type Queryable } from "../lib/db";
import { errorResponse, json, readJsonBody } from "../lib/http";
import { errorKind, logEvent } from "../lib/log";
import { FixedWindowRateLimiter } from "../lib/rateLimit";

export interface FeedbackDeps {
  getDb: () => Queryable | null;
  limiter: FixedWindowRateLimiter;
}

export function createFeedbackHandler(deps: FeedbackDeps) {
  return async (req: Request, context: Context): Promise<Response> => {
    if (!deps.limiter.allow(context.ip ?? "unknown")) {
      return errorResponse(429, "Too many requests. Please wait a minute and try again.");
    }

    const body = await readJsonBody(req);
    if (!body.ok) return body.response;

    const input = FeedbackRequestSchema.safeParse(body.value);
    if (!input.success) return errorResponse(400, input.error.issues[0]?.message ?? "Invalid request.");

    const db = deps.getDb();
    if (!db) return errorResponse(500, "The database is not configured.");

    try {
      const updated = await setFeedback(db, input.data.id, input.data.helpful);
      if (!updated) return errorResponse(404, "No result with that id.");
      logEvent("feedback_ok", { helpful: input.data.helpful });
      return json(200, { ok: true });
    } catch (error) {
      logEvent("feedback_error", errorKind(error));
      return errorResponse(500, "Could not save your feedback. Please try again.");
    }
  };
}

export default createFeedbackHandler({
  getDb: getPool,
  limiter: new FixedWindowRateLimiter(30, 60_000),
});

export const config: Config = {
  path: "/api/feedback",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
