import { accountDisplayName } from "../../core/display.js";
import {
  percentLeftFromUsed,
  pickPrimaryUsageWindows,
} from "../../core/usage.js";
import type {
  ListedAccount,
  StoredAccount,
  StoredUsageSnapshot,
  UsageResult,
  UsageSummary,
} from "../../core/types.js";
import { pad, summarizeExpiry } from "../../core/utils.js";

export function clipText(value: string, max = 34): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 3))}...`;
}

export function accountLabel(
  account: Pick<StoredAccount, "id" | "email" | "userId" | "accountId">,
): string {
  return clipText(accountDisplayName(account));
}

export function sidebarAccountLabel(
  account: Pick<StoredAccount, "id" | "email" | "userId" | "accountId">,
): string {
  return pad(clipText(accountDisplayName(account), 17), 17);
}

function formatPercentLeft(percentUsed?: number): string {
  const value = percentLeftFromUsed(percentUsed);
  return value === undefined ? "--" : `${Math.round(value)}%`;
}

function findWindow<T extends { label: string }>(
  windows: T[],
  label: string,
): T | undefined {
  return windows.find((window) => window.label === label);
}

export function usageSummaryText(
  usage?: Pick<StoredUsageSnapshot, "windows">,
): string {
  const windows = pickPrimaryUsageWindows(usage?.windows ?? []);
  const fiveHour = findWindow(windows, "5h");
  const weekly = findWindow(windows, "weekly");
  return `5h ${formatPercentLeft(fiveHour?.percentUsed)} · wk ${formatPercentLeft(weekly?.percentUsed)}`;
}

export function usageDetailLines(
  summary: UsageSummary,
  compact: boolean,
): string[] {
  const windows = pickPrimaryUsageWindows(summary.windows);
  if (compact) {
    const parts: string[] = [];
    if (summary.planType) parts.push(summary.planType);
    parts.push(usageSummaryText({ windows }));
    return [parts.join(" · ")];
  }

  const lines: string[] = [];
  if (summary.planType) {
    lines.push(`plan ${summary.planType}`);
  }

  if (!windows.length) {
    lines.push("No usage windows found.");
    return lines;
  }

  for (const window of windows) {
    const parts = [`${window.label} ${formatPercentLeft(window.percentUsed)}`];
    if (window.resetsAt) {
      parts.push(`reset ${window.resetsAt}`);
    }
    lines.push(parts.join(" · "));
  }

  return lines;
}

export function accountDetail(account: ListedAccount, now: number): string {
  return [
    usageSummaryText(account.usage),
    `exp ${summarizeExpiry(account.expiresAt, now)}`,
  ].join(" · ");
}

export function sidebarAccountDetail(account: ListedAccount): string {
  return usageSummaryText(account.usage);
}

export function usageTitle(results: UsageResult[]): string {
  return results.length > 1 ? "Stored Account Usage" : "Selected Account Usage";
}
