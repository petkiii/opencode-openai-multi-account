/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { AccountManager } from "../../core/service.js";
import { createAccountDialogs } from "./dialogs.js";
import { createSidebarPlugin } from "./sidebar.js";
import {
  loadSummary,
  SIDEBAR_COLLAPSED_KEY,
  type AccountSummary,
  watchAccountStore,
} from "./state.js";

function manager(): AccountManager {
  return new AccountManager();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const OpenAIMultiAccountTuiPlugin: TuiPlugin = async (api) => {
  const accounts = manager();
  const [summary, setSummary] = createSignal<AccountSummary>({ accounts: [] });
  const [collapsed, setCollapsed] = createSignal(
    Boolean(api.kv.get(SIDEBAR_COLLAPSED_KEY, false)),
  );
  let autoRefreshAt = 0;
  let autoRefreshPending: Promise<void> | undefined;
  let idleRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const sessionStatusById = new Map<string, "idle" | "busy" | "retry">();

  const refreshSummary = async (): Promise<AccountSummary> => {
    const next = await loadSummary();
    setSummary(next);
    return next;
  };

  const currentSummary = (): AccountSummary => summary();

  const autoRefreshUsage = async () => {
    const current = currentSummary();
    if (!current.accounts.length) return;
    if (Date.now() - autoRefreshAt < 10_000) return;
    if (autoRefreshPending) return autoRefreshPending;

    autoRefreshPending = (async () => {
      try {
        await accounts.usage({ all: true });
        await refreshSummary();
      } catch {
        // Silent background refresh.
      } finally {
        autoRefreshAt = Date.now();
        autoRefreshPending = undefined;
      }
    })();

    return autoRefreshPending;
  };

  const setSidebarCollapsed = (value: boolean) => {
    setCollapsed(value);
    api.kv.set(SIDEBAR_COLLAPSED_KEY, value);
  };

  const fail = (title: string, error: unknown) => {
    api.ui.toast({
      variant: "error",
      title,
      message: errorMessage(error),
      duration: 4000,
    });
  };

  const succeed = (title: string, message: string) => {
    api.ui.toast({
      variant: "success",
      title,
      message,
      duration: 2500,
    });
  };

  await refreshSummary();
  void autoRefreshUsage();

  const stopWatching = watchAccountStore(() => {
    void refreshSummary();
  });
  if (stopWatching) {
    api.lifecycle.onDispose(stopWatching);
  }

  const scheduleAutoRefreshUsage = () => {
    if (idleRefreshTimer) {
      clearTimeout(idleRefreshTimer);
    }
    idleRefreshTimer = setTimeout(() => {
      idleRefreshTimer = undefined;
      void autoRefreshUsage();
    }, 1500);
  };

  const stopStatusListener = api.event.on("session.status", (event) => {
    const next = event.properties.status.type;
    const previous = sessionStatusById.get(event.properties.sessionID);
    sessionStatusById.set(event.properties.sessionID, next);

    if (next === "busy") {
      if (idleRefreshTimer) {
        clearTimeout(idleRefreshTimer);
        idleRefreshTimer = undefined;
      }
      return;
    }

    if (next === "idle" && previous !== "idle") {
      scheduleAutoRefreshUsage();
    }
  });
  api.lifecycle.onDispose(() => {
    if (idleRefreshTimer) {
      clearTimeout(idleRefreshTimer);
    }
  });
  api.lifecycle.onDispose(stopStatusListener);

  const dialogs = createAccountDialogs({
    api,
    accounts,
    currentSummary,
    refreshSummary,
    fail,
    succeed,
  });

  const category = "OpenAI multi account";
  api.command.register(() => [
    {
      title: "Manage accounts",
      value: "openai-accounts.open",
      category: category,
      slash: {
        name: "accounts",
        aliases: ["openai-accounts"],
      },
      onSelect: dialogs.showMainMenu,
    },
    {
      title: "Switch account",
      value: "openai-accounts.switch",
      category: category,
      onSelect: () => {
        void dialogs.showSwitchDialog();
      },
    },
  ]);

  api.slots.register(
    createSidebarPlugin({
      summary,
      collapsed,
      setCollapsed: setSidebarCollapsed,
      openManager: dialogs.showMainMenu,
    }),
  );
};

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-openai-multi-account",
  tui: OpenAIMultiAccountTuiPlugin,
};

export default plugin;
