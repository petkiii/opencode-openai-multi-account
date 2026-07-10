import chalk from "chalk";
import Table from "cli-table3";
import { accountDisplayName } from "../core/display.js";
import type {
  ListedAccount,
  PublicAccount,
  UsageResult,
} from "../core/types.js";
import { percentLeftFromUsed } from "../core/usage.js";
import { summarizeExpiry } from "../core/utils.js";

function dash(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value)}%`;
}

function formatReset(value: string | undefined): string {
  if (!value) return "-";

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;

  const parts = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function tableHead(labels: string[]): string[] {
  return labels.map((label) => chalk.bold(label));
}

function createTable(head: string[], widths: Array<number | null>) {
  return new Table({
    head: tableHead(head),
    colWidths: widths,
    truncate: "...",
    wordWrap: false,
    style: {
      head: [],
      border: ["gray"],
      compact: true,
    },
  });
}

export function toPublicAccount(account: ListedAccount): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    userId: account.userId,
    accountId: account.accountId,
    enterpriseUrl: account.enterpriseUrl,
    expiresAt: account.expiresAt,
    addedAt: account.addedAt,
    updatedAt: account.updatedAt,
    selected: account.selected,
  };
}

export function renderAccountTable(
  accounts: ListedAccount[],
  now = Date.now(),
): string {
  if (!accounts.length) return "No stored accounts.";

  const table = createTable(
    ["Sel", "ID", "Name", "Account", "Expires", "Added"],
    [5, 10, 28, null, 16, 12],
  );

  for (const account of accounts) {
    table.push([
      account.selected ? chalk.green("*") : "",
      account.id.slice(0, 8),
      accountDisplayName(account),
      dash(account.accountId),
      summarizeExpiry(account.expiresAt, now),
      account.addedAt.slice(0, 10),
    ]);
  }

  return table.toString();
}

export function renderUsageTable(results: UsageResult[]): string {
  if (!results.length) return "No matching accounts.";

  const table = createTable(
    ["Account", "Plan", "5h", "Weekly", "5h Reset", "Weekly Reset"],
    [24, 12, 10, 10, 21, 21],
  );

  for (const result of results) {
    const accountName = accountDisplayName(result.account);
    const plan = dash(result.summary.planType);
    const fiveHour = result.summary.windows.find(
      (window) => window.label === "5h",
    );
    const weekly = result.summary.windows.find(
      (window) => window.label === "weekly",
    );

    table.push([
      accountName,
      plan,
      formatPercent(percentLeftFromUsed(fiveHour?.percentUsed)),
      formatPercent(percentLeftFromUsed(weekly?.percentUsed)),
      formatReset(fiveHour?.resetsAt),
      formatReset(weekly?.resetsAt),
    ]);
  }

  return table.toString();
}

export function toUsageJson(results: UsageResult[]): unknown {
  return results.map((result) => {
    const fiveHour = result.summary.windows.find(
      (window) => window.label === "5h",
    );
    const weekly = result.summary.windows.find(
      (window) => window.label === "weekly",
    );

    return {
      id: result.account.id,
      accountId: result.account.accountId,
      account: accountDisplayName(result.account),
      plan: dash(result.summary.planType),
      fiveHour: formatPercent(percentLeftFromUsed(fiveHour?.percentUsed)),
      weekly: formatPercent(percentLeftFromUsed(weekly?.percentUsed)),
      fiveHourReset: formatReset(fiveHour?.resetsAt),
      weeklyReset: formatReset(weekly?.resetsAt),
    };
  });
}
