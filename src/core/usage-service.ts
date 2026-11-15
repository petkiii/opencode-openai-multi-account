import type { Plugin } from "@opencode/plugin";
import {
  accountMetadata,
  supportsUsage,
  OPENAI_INTEGRATION,
} from "./accounts.js";
import {
  fetchUsagePayload,
  summarizeUsagePayload,
  toStoredUsageSnapshot,
} from "./usage.js";
import { usageEntrySchema, type UsageEntry } from "../plugin/rpc.js";

type UsageContext = Pick<Plugin.Context, "integration" | "storage">;

export function createUsageService(
  context: UsageContext,
  updated: (credentialID: string) => Promise<void>,
  now = () => Date.now(),
) {
  const pending = new Map<string, Promise<UsageEntry>>();
  const attempted = new Map<string, number>();
  const controller = new AbortController();
  const key = (id: string) => `usage:${id}`;

  const read = async (id: string): Promise<UsageEntry> => {
    const parsed = usageEntrySchema.safeParse(
      await context.storage.get(key(id)),
    );
    return parsed.success ? parsed.data : { credentialID: id };
  };

  const refresh = async (id: string): Promise<UsageEntry> => {
    const previous = await read(id);
    let entry: UsageEntry;
    try {
      const integration = await context.integration.get({
        integrationID: OPENAI_INTEGRATION,
      });
      const connection = integration.data.connections.find(
        (item) =>
          item.type === "credential" &&
          item.id === id &&
          item.method === "oauth",
      );
      if (!connection) throw new Error("Account removed.");
      const value = await context.integration.connection.resolve(connection);
      if (!value || value.type !== "oauth" || !supportsUsage(value.methodID)) {
        return {
          credentialID: id,
          error: "Quota is unavailable for this login method.",
        };
      }
      const metadata = accountMetadata(value.access, value.metadata);
      const response = await fetchUsagePayload(
        value.access,
        metadata.accountId,
        controller.signal,
      );
      if (!response.ok) {
        await response.body?.cancel();
        const message =
          response.status === 401 || response.status === 403
            ? "Usage authentication failed. Sign in again."
            : `Usage request failed: ${response.status}`;
        entry = { ...previous, error: message };
      } else {
        const summary = summarizeUsagePayload(await response.json());
        entry = {
          credentialID: id,
          snapshot: toStoredUsageSnapshot(
            summary,
            new Date(now()).toISOString(),
          ),
        };
      }
    } catch {
      entry = {
        ...previous,
        error: "Usage refresh failed. Check connection or sign in again.",
      };
    }
    if (controller.signal.aborted) return entry;
    // A concurrent deletion must not repopulate its cached snapshot.
    const current = await context.integration.get({
      integrationID: OPENAI_INTEGRATION,
    });
    if (
      !current.data.connections.some(
        (item) => item.type === "credential" && item.id === id,
      )
    ) {
      await context.storage.remove(key(id));
      return { credentialID: id, error: "Account removed." };
    }
    await context.storage.set(key(id), JSON.parse(JSON.stringify(entry)));
    await updated(id);
    return entry;
  };

  return {
    async get(input: {
      credentialIDs: string[];
      refresh: boolean;
    }): Promise<UsageEntry[]> {
      const integration = await context.integration.get({
        integrationID: OPENAI_INTEGRATION,
      });
      const allowed = new Set(
        integration.data.connections.flatMap((connection) =>
          connection.type === "credential" && connection.method === "oauth"
            ? [connection.id]
            : [],
        ),
      );
      return Promise.all(
        input.credentialIDs.map(async (id) => {
          if (!allowed.has(id)) {
            await context.storage.remove(key(id));
            return {
              credentialID: id,
              error: "OpenAI OAuth account not found.",
            };
          }
          if (!input.refresh) return read(id);
          const running = pending.get(id);
          if (running) return running;
          if (now() - (attempted.get(id) ?? -Infinity) < 10_000)
            return read(id);
          const task = refresh(id).finally(() => {
            pending.delete(id);
            attempted.set(id, now());
          });
          pending.set(id, task);
          return task;
        }),
      );
    },
    dispose() {
      controller.abort();
    },
  };
}
