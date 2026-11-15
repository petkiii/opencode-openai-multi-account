/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { openBrowser } from "../../core/browser.js";
import type { AccountManager } from "../../core/service.js";
import {
  accountLabel,
  accountDetail,
  usageDetailLines,
  usageTitle,
  sidebarAccountDetail,
} from "./labels.js";
import type { AccountSummary } from "./state.js";

interface DialogsOptions {
  api: Plugin.Context;
  accounts: AccountManager;
  currentSummary: () => AccountSummary;
  refreshSummary: () => Promise<AccountSummary>;
  fail: (title: string, error: unknown) => void;
  succeed: (title: string, message: string) => void;
}

function OAuthInfoDialog(props: {
  api: Plugin.Context;
  url: string;
  instructions: string;
}) {
  useKeyboard((event) => {
    if (event.name !== "c" || event.ctrl || event.meta || event.shift) return;
    event.preventDefault();
    event.stopPropagation();
    const copied = props.api.renderer.copyToClipboardOSC52(props.url);
    props.api.ui.toast.show({
      variant: copied ? "success" : "error",
      message: copied
        ? "OAuth URL copied"
        : "Terminal clipboard copy unavailable.",
    });
  });
  return (
    <box padding={2} flexDirection="column" gap={1}>
      <text fg={props.api.theme.text.base}>
        <b>Add OpenAI account</b>
      </text>
      <text fg={props.api.theme.text.muted}>c Copy URL · Esc Cancel</text>
      <text fg={props.api.theme.text.base}>{props.url}</text>
      <text fg={props.api.theme.text.base}>{props.instructions}</text>
      <text fg={props.api.theme.text.muted}>Waiting for authorization...</text>
    </box>
  );
}

export function createAccountDialogs(options: DialogsOptions) {
  const { api, accounts } = options;
  let authorization: AbortController | undefined;
  let disposed = false;

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      if (!disposed && !(error instanceof Error && error.name === "AbortError"))
        options.fail("Account action failed", error);
    }
  };

  const chooseAccount = async (title: string) => {
    const current = await options.refreshSummary();
    if (current.error) throw new Error(current.error);
    if (!current.accounts.length)
      throw new Error("No accounts. Add one first.");
    api.ui.dialog.set({ size: "large" });
    return api.ui.dialog.select({
      title,
      current: current.selected?.id,
      options: current.accounts.map((account) => ({
        title: accountLabel(account),
        value: account.id,
        description: `${accountDetail(account, Date.now())} · ${account.id}`,
      })),
    });
  };

  const showSwitchDialog = () =>
    run(async () => {
      const id = await chooseAccount("Switch OpenAI account");
      if (id === undefined || disposed) return;
      await accounts.selectAccount(id);
      const current = await options.refreshSummary();
      options.succeed(
        "Account selected",
        current.selected
          ? accountLabel(current.selected)
          : "Selection updated in OpenCode.",
      );
    });

  const showRemoveAccountDialog = () =>
    run(async () => {
      const id = await chooseAccount("Remove OpenAI account");
      if (id === undefined || disposed) return;
      const confirmed = await api.ui.dialog.confirm({
        title: "Remove OpenAI account",
        message:
          "Remove this credential? If active, OpenCode selects a remaining credential or disconnects when none remain.",
      });
      if (confirmed !== true || disposed) return;
      await accounts.removeAccount(id);
      const current = await options.refreshSummary();
      options.succeed(
        "Account removed",
        current.selected
          ? `Active: ${accountLabel(current.selected)}`
          : "No managed account active.",
      );
    });

  const showUsageDialog = () =>
    run(async () => {
      const results = await accounts.usage();
      await options.refreshSummary();
      if (disposed) return;
      api.ui.dialog.set({ size: "large" });
      api.ui.dialog.show(() => (
        <box padding={2} flexDirection="column" gap={1}>
          <text fg={api.theme.text.base}>
            <b>{usageTitle(results)}</b>
          </text>
          <For each={results}>
            {(result) => (
              <box flexDirection="column">
                <text fg={api.theme.text.base}>
                  <b>{accountLabel(result.account)}</b>
                  {result.account.selected ? " selected" : ""}
                </text>
                <Show when={result.error}>
                  <text fg={api.theme.text.feedback.warning.base}>
                    {result.error}
                  </text>
                </Show>
                <For
                  each={
                    result.summary
                      ? usageDetailLines(result.summary, results.length > 1)
                      : result.account.usageSupported
                        ? []
                        : [sidebarAccountDetail(result.account)]
                  }
                >
                  {(line) => <text fg={api.theme.text.muted}>{line}</text>}
                </For>
              </box>
            )}
          </For>
        </box>
      ));
    });

  const showAddDialog = (device: boolean) =>
    run(async () => {
      authorization?.abort();
      const controller = new AbortController();
      authorization = controller;
      try {
        const attempt = await accounts.startAuthorization(
          device,
          controller.signal,
        );
        if (disposed || controller.signal.aborted) {
          await accounts.cancelAuthorization(attempt).catch(() => {});
          return;
        }
        api.ui.dialog.set({ size: "large" });
        api.ui.dialog.show(
          () => (
            <OAuthInfoDialog
              api={api}
              url={attempt.url}
              instructions={attempt.instructions}
            />
          ),
          () => controller.abort(),
        );
        const waiting = accounts.waitAuthorization(attempt, controller.signal);
        void openBrowser(attempt.url);
        await waiting;
        if (disposed || controller.signal.aborted) return;
        api.ui.dialog.clear();
        await options.refreshSummary();
        options.succeed("Account connected", "New account is active.");
      } catch (error) {
        if (!disposed && !controller.signal.aborted) api.ui.dialog.clear();
        throw error;
      } finally {
        if (authorization === controller) authorization = undefined;
      }
    });

  const showMainMenu = () =>
    run(async () => {
      const hasAccounts = options.currentSummary().accounts.length > 0;
      api.ui.dialog.set({ size: "large" });
      const action = await api.ui.dialog.select({
        title: "OpenAI Accounts",
        placeholder: "Search",
        options: [
          { title: "Switch account", value: "switch", disabled: !hasAccounts },
          { title: "Account usages", value: "usage", disabled: !hasAccounts },
          { title: "Refresh usage", value: "refresh", disabled: !hasAccounts },
          { title: "Add account (browser)", value: "browser" },
          { title: "Add account (device code)", value: "device" },
          { title: "Remove account", value: "remove", disabled: !hasAccounts },
          { title: "Reload accounts", value: "reload" },
        ],
      });
      if (disposed) return;
      switch (action) {
        case "switch":
          return showSwitchDialog();
        case "usage":
          return showUsageDialog();
        case "remove":
          return showRemoveAccountDialog();
        case "browser":
          return showAddDialog(false);
        case "device":
          return showAddDialog(true);
        case "reload":
          await options.refreshSummary();
          break;
        case "refresh": {
          const results = await accounts.usage();
          await options.refreshSummary();
          const failures = results.filter((result) => result.error);
          if (failures.length)
            options.fail(
              "Usage refresh incomplete",
              new Error(
                failures
                  .map(
                    (result) =>
                      `${accountLabel(result.account)}: ${result.error}`,
                  )
                  .join("; "),
              ),
            );
          else
            options.succeed(
              "Usage refreshed",
              `Updated ${results.length} account(s).`,
            );
        }
      }
    });

  return {
    showSwitchDialog,
    showMainMenu,
    dispose() {
      disposed = true;
      authorization?.abort();
    },
  };
}
