import type { ErrorResponse, MatchResponse, StatsResponse } from "../lib/schema";

/** Error with a message that is safe and useful to show to the user. */
export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as ErrorResponse | null)?.error;
    if (res.status === 429 || res.status === 503) {
      throw new ApiError(message ?? "The service is busy, try again in a minute.");
    }
    throw new ApiError(message ?? `The server returned an error (${res.status}). Please try again.`);
  }
  return body as T;
}

export function postMatch(jd: string, cv: string): Promise<MatchResponse> {
  return request<MatchResponse>("/api/match", { method: "POST", body: JSON.stringify({ jd, cv }) });
}

export function postFeedback(id: string, helpful: boolean): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/feedback", { method: "POST", body: JSON.stringify({ id, helpful }) });
}

export function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/api/stats");
}
