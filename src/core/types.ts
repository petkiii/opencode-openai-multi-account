export interface OAuthAuth {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
  [key: string]: unknown;
}

export interface ApiAuth {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export interface WellKnownAuth {
  type: "wellknown";
  key: string;
  token: string;
  [key: string]: unknown;
}

export type OpenCodeAuth = OAuthAuth | ApiAuth | WellKnownAuth;

export type AuthFile = Record<string, OpenCodeAuth>;

export interface StoredAccount {
  id: string;
  email?: string;
  userId?: string;
  accountId?: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  enterpriseUrl?: string;
  addedAt: string;
  updatedAt: string;
}

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

export interface AccountStoreState {
  version: 1;
  selectedAccountId?: string;
  accounts: StoredAccount[];
  usageByAccountId: Record<string, StoredUsageSnapshot>;
}

export interface TokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface DeviceAuthorizationFlow {
  url: string;
  userCode: string;
  deviceAuthId: string;
  intervalMs: number;
}

export interface AuthorizationFlow {
  url: string;
  state: string;
  redirectUri: string;
  verifier: string;
  challenge: string;
}

export interface AccountUsageWindow {
  label: string;
  windowSeconds: number;
  sourcePath: string;
  resetsAt?: string;
  percentUsed?: number;
}

export interface UsageSummary {
  planType?: string;
  windows: AccountUsageWindow[];
  credits: Array<Record<string, unknown>>;
  raw: unknown;
}

export interface ListedAccount extends StoredAccount {
  selected: boolean;
  usage?: StoredUsageSnapshot;
}

export interface PublicAccount {
  id: string;
  email?: string;
  userId?: string;
  accountId?: string;
  enterpriseUrl?: string;
  expiresAt: number;
  addedAt: string;
  updatedAt: string;
  selected: boolean;
}

export interface UsageResult {
  account: StoredAccount;
  summary: UsageSummary;
}
