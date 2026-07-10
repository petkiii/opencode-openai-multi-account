import type { StoredAccount } from "./types.js";

function shortenOpaque(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function accountDisplayName(
  account: Pick<StoredAccount, "id" | "email" | "userId" | "accountId">,
): string {
  if (account.email) return account.email;
  if (account.userId) return `user:${shortenOpaque(account.userId)}`;
  if (account.accountId) return `acct:${shortenOpaque(account.accountId)}`;
  return account.id.slice(0, 8);
}
