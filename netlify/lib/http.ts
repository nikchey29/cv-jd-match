import type { ErrorResponse } from "../../lib/schema";

/** Any request body larger than this is refused before parsing. */
export const MAX_BODY_BYTES = 100_000;

/** A JSON response that browsers and CDNs must not cache. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function errorResponse(status: number, message: string): Response {
  const body: ErrorResponse = { error: message };
  return json(status, body);
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Read and parse a JSON request body, with a size limit. */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, "Request body is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse(400, "Request body must be valid JSON.") };
  }
}
