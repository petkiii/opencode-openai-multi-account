export interface StoredUsageWindow {
  label: string;
  windowSeconds: number;
  resetsAt?: string;
  percentUsed?: number;
}

export interface StoredUsageSnapshot {
  fetchedAt: string;
  planType?: string;
  windows: StoredUsageWindow[];
}

export interface ListedAccount {
  id: string;
  label: string;
  email?: string;
  userId?: string;
  accountId?: string;
  expiresAt: number;
  selected: boolean;
  usageSupported: boolean;
  usage?: StoredUsageSnapshot;
  usageError?: string;
}

export interface AccountUsageWindow extends StoredUsageWindow {
  sourcePath: string;
}

export interface UsageSummary {
  planType?: string;
  windows: AccountUsageWindow[];
}

export interface UsageResult {
  account: ListedAccount;
  summary?: StoredUsageSnapshot;
  error?: string;
}
