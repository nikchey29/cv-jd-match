/**
 * Structured logging with a strict rule: only event names, numbers, booleans
 * and short fixed strings. Never log request bodies, JD/CV text, model output,
 * IP addresses, keys, or error messages from other services (they can echo
 * request details or account ids).
 */
type LogValue = string | number | boolean | null;

export function logEvent(event: string, fields: Record<string, LogValue> = {}): void {
  console.info(JSON.stringify({ event, ...fields }));
}

/** Safe summary of an unknown error: its class name and HTTP status, if any. */
export function errorKind(error: unknown): Record<string, LogValue> {
  const name = error instanceof Error ? error.name : typeof error;
  const status =
    typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : null;
  return { errorName: name, errorStatus: status };
}
