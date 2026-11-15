/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { AccountManager } from "../../core/service.js";
import { errorMessage } from "../../core/utils.js";
import { AccountUsage } from "../rpc.js";
import { createAccountDialogs } from "./dialogs.js";
import { createSidebarPlugin } from "./sidebar.js";
import { loadSummary, type AccountSummary } from "./state.js";

export default Plugin.define({
  id: "opencode-openai-multi-account",
  async setup(context) {
    const location = context.location ?? context.data.location.default();
    const accounts = new AccountManager(() => context.client, location);
    const [summary, setSummary] = createSignal<AccountSummary>({
      accounts: [],
    });
    const [settings, updateSettings] = context.storage.store("sidebar", {
      initial: { collapsed: false },
    });
    let disposed = false;
    let summaryGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | undefined;
    let refreshedAt = -Infinity;

    const refreshSummary = async () => {
      const generation = ++summaryGeneration;
      const next = await loadSummary(accounts);
      if (!disposed && generation === summaryGeneration) setSummary(next);
      return next;
    };
    const autoRefresh = () => {
      if (
        disposed ||
        !summary().accounts.length ||
        Date.now() - refreshedAt < 10_000
      )
        return;
      if (pending) return pending;
      pending = (async () => {
        try {
          await accounts.usage();
          await refreshSummary();
        } catch {
          // Background errors appear in cached per-account usage state.
        } finally {
          refreshedAt = Date.now();
          pending = undefined;
        }
      })();
      return pending;
    };
    const cancelTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const scheduleRefresh = () => {
      cancelTimer();
      timer = setTimeout(() => {
        timer = undefined;
        void autoRefresh();
      }, 1500);
    };
    const toast = (
      variant: "error" | "success",
      title: string,
      message: string,
    ) => {
      if (!disposed)
        context.ui.toast.show({
          variant,
          title,
          message,
          duration: variant === "error" ? 4000 : 2500,
        });
    };
    const dialogs = createAccountDialogs({
      api: context,
      accounts,
      currentSummary: summary,
      refreshSummary,
      fail: (title, error) => toast("error", title, errorMessage(error)),
      succeed: (title, message) => toast("success", title, message),
    });
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "openai-accounts.open",
          title: "Manage accounts",
          group: "OpenAI multi account",
          palette: true,
          slash: { name: "accounts", aliases: ["openai-accounts"] },
          run: dialogs.showMainMenu,
        },
        {
          id: "openai-accounts.switch",
          title: "Switch account",
          group: "OpenAI multi account",
          palette: true,
          run: dialogs.showSwitchDialog,
        },
      ],
    }));
    const stopSlot = context.ui.slot(
      createSidebarPlugin({
        context,
        summary,
        collapsed: () => settings.collapsed,
        setCollapsed: (value) => {
          void updateSettings((draft) => {
            draft.collapsed = value;
          }).catch((error) => toast("error", "Setting failed", String(error)));
        },
        openManager: () => {
          void dialogs.showMainMenu();
        },
      }),
    );
    const credentialsChanged = () => {
      void refreshSummary().then(() => autoRefresh());
    };
    const stops = [
      context.data.on("credential.updated", credentialsChanged),
      context.data.on("credential.switched", credentialsChanged),
      context.data.on("integration.updated", () => {
        void refreshSummary();
      }),
      context.data.on("server.connected", credentialsChanged),
      context.data.on("session.execution.started", cancelTimer),
      context.data.on("session.execution.succeeded", scheduleRefresh),
      context.data.on("session.execution.failed", scheduleRefresh),
      context.data.on("session.execution.interrupted", scheduleRefresh),
      context.data.on(`rpc.${AccountUsage.id}.updated`, () => {
        void refreshSummary();
      }),
    ];
    await refreshSummary();
    void autoRefresh();
    return () => {
      disposed = true;
      cancelTimer();
      dialogs.dispose();
      stops.forEach((stop) => stop());
      stopSlot();
    };
  },
});
