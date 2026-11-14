import type { Config, Context } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { MatchRequestSchema, type MatchResponse } from "../../lib/schema";
import { analyzeMatch, InputTooLargeError, INPUT_TOKEN_BUDGET } from "../lib/analyze";
import { getLlmConfig } from "../lib/config";
import { getPool, insertMatchRun, type Queryable } from "../lib/db";
import { errorResponse, json, readJsonBody } from "../lib/http";
import { createGroqComplete, InvalidLlmOutputError, LlmBusyError, LlmTooLargeError, type CompleteFn } from "../lib/llm";
import { errorKind, logEvent } from "../lib/log";
import { FixedWindowRateLimiter } from "../lib/rateLimit";

export const MESSAGES = {
  rateLimited: "Too many requests from your network. Please wait a minute and try again.",
  busy: "The AI service is busy right now. Please try again in a minute.",
  invalidOutput: "The AI returned an invalid answer twice. Please try again.",
  notConfigured: "The server is not configured yet (missing GROQ_API_KEY).",
  unexpected: "Something went wrong on our side. Please try again.",
  tooLarge: (tokens: number) =>
    `Together, the job description and CV are too long for the free LLM tier (about ${tokens.toLocaleString("en-US")} tokens; the limit is ${INPUT_TOKEN_BUDGET.toLocaleString("en-US")}). Please shorten them, for example by removing CV sections that are not relevant to this job.`,
};

export interface LlmHandle {
  complete: CompleteFn;
  model: string;
}

export interface MatchDeps {
  /** Returns the LLM to use, or null when it is not configured. */
  getLlm: () => LlmHandle | null;
  /** Returns the database, or null when DATABASE_URL is not set. */
  getDb: () => Queryable | null;
  limiter: FixedWindowRateLimiter;
  now: () => number;
}

/**
 * Save the run's numbers (never the JD or CV text). Returns the row id, or
 * null if saving failed: the user still gets their result, without feedback.
 */
async function saveRun(deps: MatchDeps, row: Omit<Parameters<typeof insertMatchRun>[1], "id">): Promise<string | null> {
  const db = deps.getDb();
  if (!db) {
    logEvent("match_not_saved", { reason: "no_database" });
    return null;
  }
  const id = randomUUID();
  try {
    await insertMatchRun(db, { id, ...row });
    return id;
  } catch (error) {
    logEvent("match_not_saved", errorKind(error));
    return null;
  }
}

export function createMatchHandler(deps: MatchDeps) {
  return async (req: Request, context: Context): Promise<Response> => {
    if (!deps.limiter.allow(context.ip ?? "unknown")) {
      logEvent("match_rate_limited");
      return errorResponse(429, MESSAGES.rateLimited);
    }

    const body = await readJsonBody(req);
    if (!body.ok) return body.response;

    const input = MatchRequestSchema.safeParse(body.value);
    if (!input.success) {
      // Our zod messages are fixed strings and never contain the user's text.
      return errorResponse(400, input.error.issues[0]?.message ?? "Invalid request.");
    }

    const llm = deps.getLlm();
    if (!llm) {
      logEvent("match_not_configured");
      return errorResponse(500, MESSAGES.notConfigured);
    }

    const started = deps.now();
    try {
      const result = await analyzeMatch(input.data.jd, input.data.cv, llm.complete);
      const latencyMs = Math.round(deps.now() - started);
      const id = await saveRun(deps, {
        score: result.score,
        requirementCount: result.requirementCount,
        ungroundedCount: result.ungroundedCount,
        latencyMs,
        model: llm.model,
      });
      const response: MatchResponse = {
        id,
        score: result.score,
        scoredCount: result.scoredCount,
        requirements: result.requirements,
        traits: result.traits,
        gaps: result.gaps,
        rewrites: result.rewrites,
        requirementCount: result.requirementCount,
        ungroundedCount: result.ungroundedCount,
        unsupportedRewriteCount: result.unsupportedRewriteCount,
        model: llm.model,
        latencyMs,
      };

      logEvent("match_ok", {
        score: response.score,
        scoredCount: response.scoredCount,
        requirementCount: response.requirementCount,
        traitCount: response.traits.length,
        ungroundedCount: response.ungroundedCount,
        initialUngroundedCount: result.initialUngroundedCount,
        unsupportedRewriteCount: response.unsupportedRewriteCount,
        attempts: result.attempts,
        repairStatus: result.repair.status,
        repairFixed: result.repair.fixed,
        repairRetracted: result.repair.retracted,
        repairError: result.repair.errorName,
        latencyMs,
        saved: id !== null,
      });
      return json(200, response);
    } catch (error) {
      if (error instanceof InputTooLargeError) {
        return errorResponse(413, MESSAGES.tooLarge(error.estimatedTokens));
      }
      if (error instanceof LlmTooLargeError) {
        return errorResponse(413, MESSAGES.tooLarge(INPUT_TOKEN_BUDGET));
      }
      logEvent("match_error", errorKind(error));
      if (error instanceof LlmBusyError) return errorResponse(503, MESSAGES.busy);
      if (error instanceof InvalidLlmOutputError) return errorResponse(502, MESSAGES.invalidOutput);
      return errorResponse(500, MESSAGES.unexpected);
    }
  };
}

// One Groq client per warm function instance, rebuilt only if the settings change.
let cached: { key: string; handle: LlmHandle } | null = null;

function getGroq(): LlmHandle | null {
  const config = getLlmConfig();
  if (!config) return null;
  const key = `${config.model}:${config.apiKey}`;
  if (cached?.key !== key) {
    cached = { key, handle: { complete: createGroqComplete(config.apiKey, config.model), model: config.model } };
  }
  return cached.handle;
}

export default createMatchHandler({
  getLlm: getGroq,
  getDb: getPool,
  limiter: new FixedWindowRateLimiter(10, 60_000),
  now: () => performance.now(),
});

export const config: Config = {
  path: "/api/match",
  method: "POST",
  // Netlify's edge enforces this per IP in production: 10 requests per minute.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
