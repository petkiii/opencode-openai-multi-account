import type {
  AccountUsageWindow,
  StoredUsageSnapshot,
  StoredUsageWindow,
  UsageSummary,
} from "./types.js";
import {
  asNumber,
  asString,
  fetchWithDeadline,
  isRecord,
  toTimestamp,
} from "./utils.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export async function fetchUsagePayload(
  accessToken: string,
  accountId?: string,
): Promise<Response> {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
  });

  if (accountId) {
    headers.set("ChatGPT-Account-Id", accountId);
  }

  return fetchWithDeadline(USAGE_URL, {
    method: "GET",
    headers,
  });
}

function formatWindowLabel(windowSeconds: number): string {
  if (windowSeconds === 18_000) return "5h";
  if (windowSeconds === 604_800) return "weekly";
  if (windowSeconds % 86_400 === 0) return `${windowSeconds / 86_400}d`;
  if (windowSeconds % 3_600 === 0) return `${windowSeconds / 3_600}h`;
  if (windowSeconds % 60 === 0) return `${windowSeconds / 60}m`;
  return `${windowSeconds}s`;
}

function parseWindow(
  value: unknown,
  sourcePath: string,
): AccountUsageWindow | undefined {
  if (!isRecord(value)) return undefined;

  const windowSeconds = asNumber(value.limit_window_seconds);
  if (windowSeconds === undefined) return undefined;

  return {
    label: formatWindowLabel(windowSeconds),
    windowSeconds,
    sourcePath,
    resetsAt: toTimestamp(value.reset_at),
    percentUsed: asNumber(value.used_percent),
  };
}

export function pickPrimaryUsageWindows<
  T extends { label: string; windowSeconds: number },
>(windows: T[]): T[] {
  const selected: T[] = [];
  const fiveHour = windows.find((window) => window.label === "5h");
  const weekly = windows.find((window) => window.label === "weekly");

  if (fiveHour) selected.push(fiveHour);
  if (weekly) selected.push(weekly);
  if (selected.length > 0) return selected;

  return [...windows]
    .sort((left, right) => left.windowSeconds - right.windowSeconds)
    .slice(0, 2);
}

export function percentLeftFromUsed(
  percentUsed: number | undefined,
): number | undefined {
  return percentUsed === undefined ? undefined : 100 - percentUsed;
}

export function toStoredUsageSnapshot(
  summary: UsageSummary,
  fetchedAt: string,
): StoredUsageSnapshot {
  return {
    fetchedAt,
    planType: summary.planType,
    windows: pickPrimaryUsageWindows(summary.windows).map<StoredUsageWindow>(
      (window) => ({
        label: window.label,
        windowSeconds: window.windowSeconds,
        resetsAt: window.resetsAt,
        percentUsed: window.percentUsed,
      }),
    ),
  };
}

export function summarizeUsagePayload(payload: unknown): UsageSummary {
  const rateLimit =
    isRecord(payload) && isRecord(payload.rate_limit)
      ? payload.rate_limit
      : undefined;
  const windows = rateLimit
    ? [
        parseWindow(rateLimit.primary_window, "rate_limit.primary_window"),
        parseWindow(rateLimit.secondary_window, "rate_limit.secondary_window"),
      ].filter((window): window is AccountUsageWindow => Boolean(window))
    : [];

  return {
    planType: isRecord(payload) ? asString(payload.plan_type) : undefined,
    windows,
    credits:
      isRecord(payload) && isRecord(payload.credits) ? [payload.credits] : [],
    raw: payload,
  };
}

export function isUsageAuthFailure(response: Response): boolean {
  return response.status === 401 || response.status === 403;
}
