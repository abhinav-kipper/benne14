// One way to call the server from a browser: JSON in and out, a time limit, errors with their status.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// No request waits forever: on a weak connection a hung request would leave "Placing your order…"
// on screen with no way out. A timeout fails like any lost connection, and every write can be retried.
const TIMEOUT_MS = 12_000;
// AbortSignal.timeout() where the browser has it; a plain timer on an older tablet that does not,
// where calling it would throw and every request would look like "no internet".
export function timeLimit(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
export async function call<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const r = await fetch(url, {
    ...rest,
    signal: rest.signal ?? timeLimit(timeoutMs ?? TIMEOUT_MS),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${r.status}`, r.status);
  return body as T;
}
