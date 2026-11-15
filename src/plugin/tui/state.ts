import type { AccountManager } from "../../core/service.js";
import type { ListedAccount } from "../../core/types.js";
import { errorMessage } from "../../core/utils.js";

export type AccountSummary = {
  accounts: ListedAccount[];
  selected?: ListedAccount;
  error?: string;
};

export async function loadSummary(
  manager: AccountManager,
): Promise<AccountSummary> {
  try {
    const accounts = await manager.listAccounts();
    return { accounts, selected: accounts.find((account) => account.selected) };
  } catch (error) {
    return {
      accounts: [],
      error: errorMessage(error),
    };
  }
}
