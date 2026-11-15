import type {
  IntegrationAttempt,
  LocationRef,
  OpenCodeClient,
} from "@opencode/client";
import { setTimeout as delay } from "node:timers/promises";
import { AccountUsage } from "../plugin/rpc.js";
import {
  BROWSER_METHOD,
  DEVICE_METHOD,
  OPENAI_INTEGRATION,
  toAccount,
} from "./accounts.js";
import type { ListedAccount, UsageResult } from "./types.js";
import { errorMessage } from "./utils.js";

export type AccountClient = Pick<
  OpenCodeClient,
  "credential" | "integration" | "rpc"
>;

export class AccountManager {
  constructor(
    private readonly client: () => AccountClient,
    private readonly location: LocationRef,
  ) {}

  private async nativeAccounts(): Promise<ListedAccount[]> {
    const credentials = await this.client().credential.list();
    return credentials.flatMap((credential) => {
      const account = toAccount(credential);
      return account ? [account] : [];
    });
  }

  private async snapshots(ids: string[], refresh: boolean) {
    try {
      return await this.client()
        .rpc(AccountUsage)
        .get({ credentialIDs: ids, refresh }, { location: this.location });
    } catch (cause) {
      throw new Error(
        "OpenAI usage component unavailable. Check plugin status or reload OpenCode.",
        { cause },
      );
    }
  }

  async listAccounts(): Promise<ListedAccount[]> {
    const accounts = await this.nativeAccounts();
    const usageAccounts = accounts.filter((account) => account.usageSupported);
    if (!usageAccounts.length) return accounts;
    let snapshots;
    try {
      snapshots = await this.snapshots(
        usageAccounts.map((account) => account.id),
        false,
      );
    } catch (error) {
      return accounts.map((account) =>
        account.usageSupported
          ? {
              ...account,
              usageError: errorMessage(error),
            }
          : account,
      );
    }
    return accounts.map((account) => {
      const entry = snapshots.find(
        (snapshot) => snapshot.credentialID === account.id,
      );
      return { ...account, usage: entry?.snapshot, usageError: entry?.error };
    });
  }

  async selectAccount(credentialID: string): Promise<void> {
    await this.client().credential.activate({ credentialID });
  }

  async removeAccount(credentialID: string): Promise<void> {
    await this.client().credential.remove({ credentialID });
  }

  async usage(): Promise<UsageResult[]> {
    const targets = await this.nativeAccounts();
    const ids = targets
      .filter((account) => account.usageSupported)
      .map((account) => account.id);
    const results = ids.length ? await this.snapshots(ids, true) : [];
    return targets.map((account) => {
      const entry = results.find((item) => item.credentialID === account.id);
      return { account, summary: entry?.snapshot, error: entry?.error };
    });
  }

  async startAuthorization(
    device: boolean,
    signal?: AbortSignal,
  ): Promise<IntegrationAttempt> {
    try {
      const result = await this.client().integration.oauth.connect(
        {
          integrationID: OPENAI_INTEGRATION,
          methodID: device ? DEVICE_METHOD : BROWSER_METHOD,
          location: this.location,
        },
        { signal },
      );
      return result.data;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw error;
    }
  }

  async cancelAuthorization(attempt: IntegrationAttempt): Promise<void> {
    await this.client().integration.oauth.cancel(
      {
        integrationID: OPENAI_INTEGRATION,
        attemptID: attempt.attemptID,
        location: this.location,
      },
      { signal: AbortSignal.timeout(5000) },
    );
  }

  async waitAuthorization(
    attempt: IntegrationAttempt,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      while (true) {
        signal.throwIfAborted();
        const response = await this.client().integration.oauth.status(
          {
            integrationID: OPENAI_INTEGRATION,
            attemptID: attempt.attemptID,
            location: this.location,
          },
          { signal },
        );
        const status = response.data;
        if (status.status === "complete") return;
        if (status.status === "failed") throw new Error(status.message);
        if (status.status === "expired" || Date.now() >= attempt.time.expires)
          throw new Error("Authorization expired. Start login again.");
        await delay(1000, undefined, { signal });
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      await this.cancelAuthorization(attempt).catch(() => {});
    }
  }
}
