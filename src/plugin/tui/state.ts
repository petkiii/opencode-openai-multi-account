import fs from "node:fs";
import { listAccounts, readAccountStore } from "../../core/store.js";
import { resolvePaths } from "../../core/paths.js";
import type { ListedAccount } from "../../core/types.js";

export type AccountSummary = {
  accounts: ListedAccount[];
  selected?: ListedAccount;
  error?: string;
};

export const SIDEBAR_COLLAPSED_KEY = "openai-accounts.sidebar-collapsed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadSummary(): Promise<AccountSummary> {
  try {
    const paths = resolvePaths();
    const state = await readAccountStore(paths.storeFile);
    const accounts = listAccounts(state);
    return {
      accounts,
      selected: accounts.find((account) => account.selected),
    };
  } catch (error) {
    return {
      accounts: [],
      error: errorMessage(error),
    };
  }
}

export function watchAccountStore(
  onChange: () => void,
): (() => void) | undefined {
  const paths = resolvePaths();

  try {
    fs.mkdirSync(paths.packageDataDir, { recursive: true, mode: 0o700 });
    const watcher = fs.watch(paths.packageDataDir, onChange);
    return () => watcher.close();
  } catch {
    return undefined;
  }
}
