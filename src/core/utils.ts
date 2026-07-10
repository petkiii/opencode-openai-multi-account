export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function sortBy<T>(
  items: T[],
  compare: (left: T, right: T) => number,
): T[] {
  return [...items].sort(compare);
}

export function formatIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function summarizeExpiry(expiresAt: number, now: number): string {
  const deltaMs = expiresAt - now;
  if (deltaMs <= 0) return "expired";

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < minute) return "<1m";
  if (deltaMs < hour) return `${Math.ceil(deltaMs / minute)}m`;
  if (deltaMs < day) return `${Math.ceil(deltaMs / hour)}h`;
  return `${Math.ceil(deltaMs / day)}d`;
}

export function toTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString();

  const numeric = asNumber(value);
  if (numeric !== undefined) {
    const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return formatIsoDate(milliseconds);
  }

  const text = asString(value);
  if (!text) return undefined;

  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp)
    ? undefined
    : new Date(timestamp).toISOString();
}

export function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + " ".repeat(width - value.length);
}

export function fetchWithDeadline(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const deadline = AbortSignal.timeout(15_000);
  return fetch(input, {
    ...init,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
}
