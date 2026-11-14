import type { RequirementStatus } from "./schema";

/** Points each status contributes to the score. */
export const STATUS_POINTS: Record<RequirementStatus, number> = {
  met: 1,
  partly_met: 0.5,
  not_met: 0,
};

/**
 * Match score from 0 to 100, computed in code (never by the LLM):
 * the average points per scored requirement, as a rounded percentage.
 * Unverified requirements are not passed in, so they are not in the
 * denominator. With nothing to score there is no score: null.
 */
export function computeScore(statuses: readonly RequirementStatus[]): number | null {
  if (statuses.length === 0) return null;
  const points = statuses.reduce((sum, status) => sum + STATUS_POINTS[status], 0);
  return Math.round((points / statuses.length) * 100);
}
