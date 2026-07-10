import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonAtomic } from "./fs.js";
import type {
  AccountStoreState,
  ListedAccount,
  StoredAccount,
  StoredUsageSnapshot,
  StoredUsageWindow,
} from "./types.js";
import { asNumber, asString, isRecord, sortBy } from "./utils.js";

const STORE_VERSION = 1 as const;

export function emptyAccountStore(): AccountStoreState {
  return {
    version: STORE_VERSION,
    accounts: [],
    usageByAccountId: {},
  };
}

function normalizeUsageWindow(value: unknown): StoredUsageWindow | undefined {
  if (!isRecord(value)) return undefined;

  const label = asString(value.label);
  const windowSeconds = asNumber(value.windowSeconds);
  if (!label || windowSeconds === undefined) return undefined;

  return {
    label,
    windowSeconds,
    resetsAt: asString(value.resetsAt),
    percentUsed: asNumber(value.percentUsed),
  };
}

function normalizeUsageSnapshot(
  value: unknown,
): StoredUsageSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const fetchedAt = asString(value.fetchedAt);
  if (!fetchedAt) return undefined;

  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((window) => normalizeUsageWindow(window))
        .filter((window): window is StoredUsageWindow => Boolean(window))
    : [];

  return {
    fetchedAt,
    planType: asString(value.planType),
    windows,
  };
}

export async function readAccountStore(
  filePath: string,
): Promise<AccountStoreState> {
  const raw = await readJsonFile<AccountStoreState>(
    filePath,
    emptyAccountStore(),
  );
  if (raw.version !== STORE_VERSION || !Array.isArray(raw.accounts)) {
    return emptyAccountStore();
  }

  const accounts = raw.accounts.filter(
    (account): account is StoredAccount => typeof account?.id === "string",
  );
  const accountIds = new Set(accounts.map((account) => account.id));
  const usageByAccountId = isRecord(raw.usageByAccountId)
    ? Object.fromEntries(
        Object.entries(raw.usageByAccountId)
          .filter(([accountId]) => accountIds.has(accountId))
          .map(([accountId, usage]) => [
            accountId,
            normalizeUsageSnapshot(usage),
          ])
          .filter((entry): entry is [string, StoredUsageSnapshot] =>
            Boolean(entry[1]),
          ),
      )
    : {};

  return {
    version: STORE_VERSION,
    selectedAccountId:
      typeof raw.selectedAccountId === "string"
        ? raw.selectedAccountId
        : undefined,
    accounts,
    usageByAccountId,
  };
}

export async function writeAccountStore(
  filePath: string,
  state: AccountStoreState,
): Promise<void> {
  await writeJsonAtomic(filePath, state);
}

export interface UpsertAccountInput {
  email?: string;
  userId?: string;
  accountId?: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  enterpriseUrl?: string;
}

function sameText(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function findExistingAccountIndex(
  state: AccountStoreState,
  input: UpsertAccountInput,
): number {
  return state.accounts.findIndex((account) => {
    if (input.accountId && sameText(account.accountId, input.accountId))
      return true;
    if (input.userId && sameText(account.userId, input.userId)) return true;
    return account.refreshToken === input.refreshToken;
  });
}

export function upsertAccount(
  state: AccountStoreState,
  input: UpsertAccountInput,
  nowIso: string,
  createId: () => string = randomUUID,
): { state: AccountStoreState; account: StoredAccount } {
  const index = findExistingAccountIndex(state, input);

  if (index >= 0) {
    const existing = state.accounts[index];
    const account: StoredAccount = {
      ...existing,
      email: input.email ?? existing.email,
      userId: input.userId ?? existing.userId,
      accountId: input.accountId ?? existing.accountId,
      refreshToken: input.refreshToken,
      accessToken: input.accessToken,
      expiresAt: input.expiresAt,
      enterpriseUrl: input.enterpriseUrl ?? existing.enterpriseUrl,
      updatedAt: nowIso,
    };

    const accounts = [...state.accounts];
    accounts[index] = account;

    return {
      state: { ...state, accounts },
      account,
    };
  }

  const account: StoredAccount = {
    id: createId(),
    email: input.email,
    userId: input.userId,
    accountId: input.accountId,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    expiresAt: input.expiresAt,
    enterpriseUrl: input.enterpriseUrl,
    addedAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    state: {
      ...state,
      accounts: [...state.accounts, account],
    },
    account,
  };
}

export function requireSelectedAccount(
  state: AccountStoreState,
): StoredAccount {
  if (!state.selectedAccountId) {
    throw new Error("No selected account. Use 'ooma select <account>' first.");
  }

  return requireAccount(state, state.selectedAccountId);
}

export function requireAccount(
  state: AccountStoreState,
  selector: string,
): StoredAccount {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) throw new Error("Account selector is required.");

  const exact = state.accounts.find((account) => {
    return (
      account.id.toLowerCase() === normalized ||
      account.email?.toLowerCase() === normalized ||
      account.userId?.toLowerCase() === normalized ||
      account.accountId?.toLowerCase() === normalized
    );
  });
  if (exact) return exact;

  const prefixMatches = state.accounts.filter((account) =>
    account.id.toLowerCase().startsWith(normalized),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new Error(`Account selector '${selector}' is ambiguous.`);
  }

  throw new Error(`Account '${selector}' not found.`);
}

export function setUsageSnapshot(
  state: AccountStoreState,
  accountId: string,
  usage: StoredUsageSnapshot,
): AccountStoreState {
  return {
    ...state,
    usageByAccountId: {
      ...state.usageByAccountId,
      [accountId]: usage,
    },
  };
}

export function clearUsageSnapshot(
  state: AccountStoreState,
  accountId: string,
): AccountStoreState {
  if (!(accountId in state.usageByAccountId)) return state;

  const usageByAccountId = { ...state.usageByAccountId };
  delete usageByAccountId[accountId];
  return {
    ...state,
    usageByAccountId,
  };
}

export function listAccounts(state: AccountStoreState): ListedAccount[] {
  return sortBy(
    state.accounts.map((account) => ({
      ...account,
      selected: state.selectedAccountId === account.id,
      usage: state.usageByAccountId[account.id],
    })),
    (left, right) => {
      if (left.selected !== right.selected) return left.selected ? -1 : 1;
      return left.addedAt.localeCompare(right.addedAt);
    },
  );
}
