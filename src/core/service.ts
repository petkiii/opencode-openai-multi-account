import { resolvePaths, type ResolvedPaths } from "./paths.js";
import {
  awaitDeviceAuthorization,
  awaitOAuthCallback,
  createAuthorizationFlow,
  createDeviceAuthorizationFlow,
  exchangeAuthorizationInput,
  extractAccountMetadata,
  refreshAccessToken,
} from "./oauth.js";
import {
  fetchUsagePayload,
  isUsageAuthFailure,
  summarizeUsagePayload,
  toStoredUsageSnapshot,
} from "./usage.js";
import {
  getCanonicalOpenAIAuth,
  isOAuthAuth,
  oauthAuthMatchesStoredAccount,
  removeCanonicalOpenAIAuth,
  storedAccountToOAuthAuth,
  writeCanonicalOpenAIAuth,
} from "./auth-store.js";
import {
  clearUsageSnapshot,
  listAccounts,
  readAccountStore,
  requireAccount,
  requireSelectedAccount,
  setUsageSnapshot,
  upsertAccount,
  writeAccountStore,
} from "./store.js";
import { withFileLock } from "./lock.js";
import type {
  AccountStoreState,
  AuthorizationFlow,
  DeviceAuthorizationFlow,
  ListedAccount,
  StoredAccount,
  TokenResponse,
  UsageResult,
} from "./types.js";

const REFRESH_MARGIN_MS = 60_000;

export interface AccountManagerOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  createId?: () => string;
}

export class AccountManager {
  readonly paths: ResolvedPaths;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: AccountManagerOptions = {}) {
    this.paths = resolvePaths(options.env);
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async listAccounts(): Promise<ListedAccount[]> {
    const state = await readAccountStore(this.paths.storeFile);
    return listAccounts(state);
  }

  async importCurrent(
    options: { select?: boolean } = {},
  ): Promise<StoredAccount> {
    return this.withMutationLock(async () => {
      const auth = await getCanonicalOpenAIAuth(this.paths.openCodeAuthFile);
      if (!isOAuthAuth(auth)) {
        throw new Error(
          "OpenCode canonical openai auth is missing or is not OAuth.",
        );
      }

      const metadata = extractAccountMetadata({
        access_token: auth.access,
        refresh_token: auth.refresh,
      });
      const nowIso = new Date(this.now()).toISOString();
      const current = await readAccountStore(this.paths.storeFile);
      const imported = upsertAccount(
        current,
        {
          email: metadata.email,
          userId: metadata.userId,
          accountId: auth.accountId ?? metadata.accountId,
          refreshToken: auth.refresh,
          accessToken: auth.access,
          expiresAt: auth.expires,
          enterpriseUrl: auth.enterpriseUrl,
        },
        nowIso,
        this.createId,
      );

      const shouldSelect = options.select || !imported.state.selectedAccountId;
      const nextState = shouldSelect
        ? { ...imported.state, selectedAccountId: imported.account.id }
        : imported.state;

      await writeAccountStore(this.paths.storeFile, nextState);
      return imported.account;
    });
  }

  async createAuthorizationFlow(
    options: { port?: number; redirectHost?: string } = {},
  ): Promise<AuthorizationFlow> {
    return createAuthorizationFlow(options);
  }

  async addAccountFromAuthorizationInput(
    flow: AuthorizationFlow,
    input: string,
    options: { select?: boolean } = {},
  ): Promise<StoredAccount> {
    const tokens = await exchangeAuthorizationInput(
      input,
      flow,
    );
    return this.addAccountFromTokens(tokens, options);
  }

  async addAccountFromTokens(
    tokens: TokenResponse,
    options: { select?: boolean } = {},
  ): Promise<StoredAccount> {
    return this.withMutationLock(async () => {
      if (!tokens.refresh_token) {
        throw new Error("OAuth refresh token missing from token exchange.");
      }

      const metadata = extractAccountMetadata(tokens);
      const nowMs = this.now();
      const nowIso = new Date(nowMs).toISOString();
      const current = await readAccountStore(this.paths.storeFile);
      const upserted = upsertAccount(
        current,
        {
          email: metadata.email,
          userId: metadata.userId,
          accountId: metadata.accountId,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          expiresAt: nowMs + (tokens.expires_in ?? 3600) * 1000,
        },
        nowIso,
        this.createId,
      );

      const nextState = options.select
        ? { ...upserted.state, selectedAccountId: upserted.account.id }
        : upserted.state;

      await writeAccountStore(this.paths.storeFile, nextState);
      if (options.select) {
        await writeCanonicalOpenAIAuth(
          this.paths.openCodeAuthFile,
          storedAccountToOAuthAuth(upserted.account),
        );
      }
      return upserted.account;
    });
  }

  async addAccountFromBrowserFlow(
    flow: AuthorizationFlow,
    options: {
      listenHost?: string;
      timeoutMs?: number;
      select?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<StoredAccount> {
    const tokens = await awaitOAuthCallback(flow, {
      listenHost: options.listenHost,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return this.addAccountFromTokens(tokens, { select: options.select });
  }

  async createDeviceAuthorizationFlow(): Promise<DeviceAuthorizationFlow> {
    return createDeviceAuthorizationFlow();
  }

  async addAccountViaDeviceCode(
    flow: DeviceAuthorizationFlow,
    options: {
      select?: boolean;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<StoredAccount> {
    const tokens = await awaitDeviceAuthorization(flow, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    return this.addAccountFromTokens(tokens, options);
  }

  async selectAccount(selector: string): Promise<StoredAccount> {
    return this.withMutationLock(async () => {
      const state = await readAccountStore(this.paths.storeFile);
      const account = requireAccount(state, selector);
      const refreshed = await this.refreshAccountInState(state, account.id);
      const nextState = {
        ...refreshed.state,
        selectedAccountId: refreshed.account.id,
      };
      await writeAccountStore(this.paths.storeFile, nextState);
      await writeCanonicalOpenAIAuth(
        this.paths.openCodeAuthFile,
        storedAccountToOAuthAuth(refreshed.account),
      );
      return refreshed.account;
    });
  }

  async removeAccount(
    selector: string,
    replacementSelector?: string,
  ): Promise<{
    removed: StoredAccount;
    selected?: StoredAccount;
    clearedCanonicalAuth: boolean;
  }> {
    return this.withMutationLock(async () => {
      const state = await readAccountStore(this.paths.storeFile);
      const removed = requireAccount(state, selector);
      const remainingState = clearUsageSnapshot(
        {
          ...state,
          accounts: state.accounts.filter(
            (account) => account.id !== removed.id,
          ),
        },
        removed.id,
      );

      const removingSelected = state.selectedAccountId === removed.id;
      if (!removingSelected) {
        await writeAccountStore(this.paths.storeFile, remainingState);
        return { removed, clearedCanonicalAuth: false };
      }

      if (replacementSelector) {
        const replacement = requireAccount(remainingState, replacementSelector);
        const refreshed = await this.refreshAccountInState(
          remainingState,
          replacement.id,
        );
        const nextState = {
          ...refreshed.state,
          selectedAccountId: refreshed.account.id,
        };
        await writeAccountStore(this.paths.storeFile, nextState);
        await writeCanonicalOpenAIAuth(
          this.paths.openCodeAuthFile,
          storedAccountToOAuthAuth(refreshed.account),
        );
        return {
          removed,
          selected: refreshed.account,
          clearedCanonicalAuth: false,
        };
      }

      const nextState = {
        ...remainingState,
        selectedAccountId: undefined,
      };
      await writeAccountStore(this.paths.storeFile, nextState);

      const canonical = await getCanonicalOpenAIAuth(
        this.paths.openCodeAuthFile,
      );
      const shouldClearCanonical = oauthAuthMatchesStoredAccount(
        canonical,
        removed,
      );
      if (shouldClearCanonical) {
        await removeCanonicalOpenAIAuth(this.paths.openCodeAuthFile);
      }

      return { removed, clearedCanonicalAuth: shouldClearCanonical };
    });
  }

  async usage(
    options: { selector?: string; all?: boolean } = {},
  ): Promise<UsageResult[]> {
    const state = await readAccountStore(this.paths.storeFile);
    if (options.all) {
      const results: UsageResult[] = [];
      const errors: string[] = [];
      for (const account of state.accounts) {
        try {
          results.push(await this.fetchUsageForAccount(account.id));
        } catch (error) {
          errors.push(
            `${account.email ?? account.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!results.length && errors.length) {
        throw new Error(
          `Usage refresh failed for all accounts: ${errors.join("; ")}`,
        );
      }
      return results;
    }

    const target = options.selector
      ? requireAccount(state, options.selector)
      : requireSelectedAccount(state);
    return [await this.fetchUsageForAccount(target.id)];
  }

  private async fetchUsageForAccount(accountId: string): Promise<UsageResult> {
    let account = await this.getFreshAccount(accountId);
    let response = await fetchUsagePayload(
      account.accessToken,
      account.accountId,
    );

    if (isUsageAuthFailure(response)) {
      account = await this.forceRefreshAccount(account.id);
      response = await fetchUsagePayload(
        account.accessToken,
        account.accountId,
      );
    }

    if (!response.ok) {
      throw new Error(`Usage request failed: ${response.status}`);
    }

    const payload = await response.json();
    const summary = summarizeUsagePayload(payload);
    await this.persistUsageSnapshot(account.id, summary);

    return {
      account,
      summary,
    };
  }

  private async persistUsageSnapshot(
    accountId: string,
    summary: UsageResult["summary"],
  ): Promise<void> {
    await this.withMutationLock(async () => {
      const state = await readAccountStore(this.paths.storeFile);
      if (!state.accounts.some((account) => account.id === accountId)) {
        return;
      }

      const nextState = setUsageSnapshot(
        state,
        accountId,
        toStoredUsageSnapshot(summary, new Date(this.now()).toISOString()),
      );
      await writeAccountStore(this.paths.storeFile, nextState);
    });
  }

  private async getFreshAccount(accountId: string): Promise<StoredAccount> {
    return this.withMutationLock(async () => {
      const state = await readAccountStore(this.paths.storeFile);
      const refreshed = await this.refreshAccountInState(state, accountId);
      if (refreshed.changed) {
        await writeAccountStore(this.paths.storeFile, refreshed.state);
        await this.syncCanonicalAuthIfSelected(
          refreshed.state,
          refreshed.account,
        );
      }
      return refreshed.account;
    });
  }

  private async forceRefreshAccount(accountId: string): Promise<StoredAccount> {
    return this.withMutationLock(async () => {
      const state = await readAccountStore(this.paths.storeFile);
      const refreshed = await this.refreshAccountInState(
        state,
        accountId,
        true,
      );
      await writeAccountStore(this.paths.storeFile, refreshed.state);
      await this.syncCanonicalAuthIfSelected(
        refreshed.state,
        refreshed.account,
      );
      return refreshed.account;
    });
  }

  private async syncCanonicalAuthIfSelected(
    state: AccountStoreState,
    account: StoredAccount,
  ): Promise<void> {
    if (state.selectedAccountId !== account.id) return;

    const canonical = await getCanonicalOpenAIAuth(this.paths.openCodeAuthFile);
    if (!isOAuthAuth(canonical)) return;

    await writeCanonicalOpenAIAuth(
      this.paths.openCodeAuthFile,
      storedAccountToOAuthAuth(account),
    );
  }

  private async refreshAccountInState(
    state: AccountStoreState,
    accountId: string,
    force = false,
  ): Promise<{
    state: AccountStoreState;
    account: StoredAccount;
    changed: boolean;
  }> {
    const account = requireAccount(state, accountId);
    const shouldRefresh =
      force || account.expiresAt <= this.now() + REFRESH_MARGIN_MS;
    if (!shouldRefresh) {
      return { state, account, changed: false };
    }

      const tokens = await refreshAccessToken(account.refreshToken);
    const metadata = extractAccountMetadata(tokens);
    const updated: StoredAccount = {
      ...account,
      email: metadata.email ?? account.email,
      userId: metadata.userId ?? account.userId,
      accountId: metadata.accountId ?? account.accountId,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      accessToken: tokens.access_token,
      expiresAt: this.now() + (tokens.expires_in ?? 3600) * 1000,
      updatedAt: new Date(this.now()).toISOString(),
    };

    return {
      state: {
        ...state,
        accounts: state.accounts.map((entry) =>
          entry.id === updated.id ? updated : entry,
        ),
      },
      account: updated,
      changed: true,
    };
  }

  private async withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(this.paths.locksDir, "state", fn);
  }
}
