/** @jsxImportSource @opentui/solid */
import type {
  TuiDialogSelectOption,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui";
import { useKeyboard } from "@opentui/solid";
import { For } from "solid-js";
import { openBrowser } from "../../core/browser.js";
import { AccountManager } from "../../core/service.js";
import { isAuthorizationCancelledError } from "../../core/oauth.js";
import type { ListedAccount, UsageResult } from "../../core/types.js";
import {
  accountLabel,
  accountDetail,
  usageDetailLines,
  usageTitle,
} from "./labels.js";
import type { AccountSummary } from "./state.js";

type MenuAction =
  | "switch"
  | "usage-all"
  | "refresh-usage"
  | "add-browser"
  | "add-device"
  | "import"
  | "remove"
  | "refresh-state";

interface DialogsOptions {
  api: TuiPluginApi;
  accounts: AccountManager;
  currentSummary: () => AccountSummary;
  refreshSummary: () => Promise<AccountSummary>;
  fail: (title: string, error: unknown) => void;
  succeed: (title: string, message: string) => void;
}

function OAuthInfoDialog(props: {
  api: TuiPluginApi;
  title: string;
  intro: string;
  copyLabel: string;
  copyText: string;
  lines: string[];
}) {
  useKeyboard((event) => {
    if (event.name !== "c" || event.ctrl || event.meta || event.shift) return;
    event.preventDefault();
    event.stopPropagation();
    const copied = props.api.renderer.copyToClipboardOSC52(props.copyText);
    props.api.ui.toast({
      variant: copied ? "success" : "error",
      title: copied ? "Copied" : "Copy failed",
      message: copied
        ? props.copyLabel
        : "Terminal clipboard copy unavailable.",
      duration: 2500,
    });
  });

  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="column"
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={props.api.theme.current.text}>
          <b>{props.title}</b>
        </text>
        <text fg={props.api.theme.current.textMuted}>c Copy</text>
      </box>
      <text fg={props.api.theme.current.textMuted}>{props.intro}</text>
      <For each={props.lines}>
        {(line, index) => (
          <text
            fg={
              index() === 0
                ? props.api.theme.current.primary
                : props.api.theme.current.text
            }
          >
            {line}
          </text>
        )}
      </For>
    </box>
  );
}

export function createAccountDialogs(options: DialogsOptions) {
  const refreshUsage = async (input: {
    selector?: string;
    all?: boolean;
  }): Promise<UsageResult[]> => {
    const results = await options.accounts.usage(input);
    await options.refreshSummary();
    return results;
  };

  const showUsageDialog = async (input: {
    selector?: string;
    all?: boolean;
  }) => {
    try {
      const results = await refreshUsage(input);
      const current = options.currentSummary();
      const compact = results.length > 1;

      options.api.ui.dialog.setSize("medium");
      options.api.ui.dialog.replace(() => (
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="column"
          gap={1}
        >
          <text fg={options.api.theme.current.text}>
            <b>{usageTitle(results)}</b>
          </text>
          <For each={results}>
            {(result) => (
              <box flexDirection="column" gap={0}>
                <text fg={options.api.theme.current.text}>
                  <b>{accountLabel(result.account)}</b>
                  {current.selected?.id === result.account.id
                    ? " selected"
                    : ""}
                </text>
                <For each={usageDetailLines(result.summary, compact)}>
                  {(line) => (
                    <text fg={options.api.theme.current.textMuted}>{line}</text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      ));
    } catch (error) {
      options.fail("Usage failed", error);
    }
  };

  const showRemoveConfirmation = (
    account: ListedAccount,
    replacement?: ListedAccount,
  ) => {
    const message = replacement
      ? `Remove ${accountLabel(account)} and switch to ${accountLabel(replacement)}?`
      : account.selected
        ? `Remove ${accountLabel(account)}? This clears canonical OpenAI OAuth auth until another account is selected.`
        : `Remove ${accountLabel(account)}?`;

    options.api.ui.dialog.setSize("medium");
    options.api.ui.dialog.replace(() => (
      <options.api.ui.DialogConfirm
        title="Remove OpenAI account"
        message={message}
        onConfirm={() => {
          void (async () => {
            try {
              const result = await options.accounts.removeAccount(
                account.id,
                replacement?.id,
              );
              await options.refreshSummary();
              options.succeed(
                "Account removed",
                result.selected
                  ? `Switched to ${accountLabel(result.selected)}.`
                  : `Removed ${accountLabel(account)}.`,
              );
              options.api.ui.dialog.clear();
            } catch (error) {
              options.fail("Remove failed", error);
            }
          })();
        }}
        onCancel={() => {
          void showRemoveAccountDialog();
        }}
      />
    ));
  };

  const showReplacementDialog = (
    account: ListedAccount,
    replacements: ListedAccount[],
  ) => {
    const replacementOptions: TuiDialogSelectOption<ListedAccount | null>[] = [
      ...replacements.map((replacement) => ({
        title: accountLabel(replacement),
        value: replacement,
        description: accountDetail(replacement, Date.now()),
      })),
      {
        title: "Remove and clear active OpenAI OAuth auth",
        value: null,
        description: "Use no replacement account.",
      },
    ];

    options.api.ui.dialog.setSize("large");
    options.api.ui.dialog.replace(() => (
      <options.api.ui.DialogSelect
        title="Choose replacement account"
        options={replacementOptions}
        onSelect={(option: TuiDialogSelectOption<ListedAccount | null>) => {
          showRemoveConfirmation(account, option.value ?? undefined);
        }}
      />
    ));
  };

  const showRemoveAccountDialog = async () => {
    const current = options.currentSummary();
    if (!current.accounts.length) {
      options.fail("Remove failed", new Error("No stored accounts to remove."));
      return;
    }

    options.api.ui.dialog.setSize("large");
    const accountOptions: TuiDialogSelectOption<ListedAccount>[] =
      current.accounts.map((account) => ({
        title: accountLabel(account),
        value: account,
        description: accountDetail(account, Date.now()),
      }));

    options.api.ui.dialog.replace(() => (
      <options.api.ui.DialogSelect
        title="Remove stored account"
        options={accountOptions}
        onSelect={(option: TuiDialogSelectOption<ListedAccount>) => {
          const account = option.value;
          const replacements = current.accounts.filter(
            (entry) => entry.id !== account.id,
          );
          if (account.selected && replacements.length > 0) {
            showReplacementDialog(account, replacements);
            return;
          }
          showRemoveConfirmation(account);
        }}
      />
    ));
  };

  const showAddBrowserDialog = async () => {
    const controller = new AbortController();
    try {
      const flow = await options.accounts.createAuthorizationFlow();
      const browserOpened = await openBrowser(flow.url);

      options.api.ui.dialog.setSize("medium");
      options.api.ui.dialog.replace(
        () => (
          <OAuthInfoDialog
            api={options.api}
            title="Add OpenAI account"
            intro={
              browserOpened
                ? "Browser opened. Complete login there."
                : "Open authorization URL below in your browser."
            }
            copyLabel="OAuth URL copied"
            copyText={flow.url}
            lines={[flow.url, "Waiting for callback..."]}
          />
        ),
        () => {
          controller.abort();
        },
      );

      const account = await options.accounts.addAccountFromBrowserFlow(flow, {
        signal: controller.signal,
      });
      await options.refreshSummary();
      options.succeed("Account stored", accountLabel(account));
      options.api.ui.dialog.clear();
    } catch (error) {
      if (isAuthorizationCancelledError(error)) return;
      options.fail("Add failed", error);
    }
  };

  const showAddDeviceDialog = async () => {
    const controller = new AbortController();
    try {
      const flow = await options.accounts.createDeviceAuthorizationFlow();

      options.api.ui.dialog.setSize("medium");
      options.api.ui.dialog.replace(
        () => (
          <OAuthInfoDialog
            api={options.api}
            title="Add OpenAI account"
            intro="Open URL below and enter this code:"
            copyLabel="OAuth URL copied"
            copyText={flow.url}
            lines={[flow.url, flow.userCode, "Waiting for confirmation..."]}
          />
        ),
        () => {
          controller.abort();
        },
      );

      const account = await options.accounts.addAccountViaDeviceCode(flow, {
        signal: controller.signal,
      });
      await options.refreshSummary();
      options.succeed("Account stored", accountLabel(account));
      options.api.ui.dialog.clear();
    } catch (error) {
      if (isAuthorizationCancelledError(error)) return;
      options.fail("Add failed", error);
    }
  };

  const showSwitchDialog = async () => {
    const current = options.currentSummary();
    if (!current.accounts.length) {
      options.fail(
        "Switch failed",
        new Error("No stored accounts. Add or import one first."),
      );
      return;
    }

    options.api.ui.dialog.setSize("large");
    const accountOptions: TuiDialogSelectOption<ListedAccount>[] =
      current.accounts.map((account) => ({
        title: accountLabel(account),
        value: account,
        description: accountDetail(account, Date.now()),
      }));

    options.api.ui.dialog.replace(() => (
      <options.api.ui.DialogSelect
        title="Switch OpenAI account"
        options={accountOptions}
        current={current.selected}
        onSelect={(option: TuiDialogSelectOption<ListedAccount>) => {
          void (async () => {
            try {
              const selected = await options.accounts.selectAccount(
                option.value.id,
              );
              await options.refreshSummary();
              options.succeed("Account selected", accountLabel(selected));
              options.api.ui.dialog.clear();
            } catch (error) {
              options.fail("Switch failed", error);
            }
          })();
        }}
      />
    ));
  };

  const showMainMenu = () => {
    const current = options.currentSummary();
    const menuOptions: TuiDialogSelectOption<MenuAction>[] = [
      {
        title: "Switch account",
        value: "switch",
        description: current.accounts.length
          ? undefined
          : "No stored accounts.",
        disabled: !current.accounts.length,
      },
      {
        title: "Account usages",
        value: "usage-all",
        description: current.accounts.length
          ? undefined
          : "No stored accounts.",
        disabled: !current.accounts.length,
      },
      {
        title: "Refresh usage",
        value: "refresh-usage",
        description: current.accounts.length
          ? undefined
          : "No stored accounts.",
        disabled: !current.accounts.length,
      },
      {
        title: "Add account (browser)",
        value: "add-browser",
      },
      {
        title: "Add account (device code)",
        value: "add-device",
      },
      {
        title: "Import current OpenCode openai auth",
        value: "import",
      },
      {
        title: "Remove account",
        value: "remove",
        description: current.accounts.length
          ? undefined
          : "No stored accounts.",
        disabled: !current.accounts.length,
      },
      {
        title: "Reload accounts from disk",
        value: "refresh-state",
      },
    ];

    options.api.ui.dialog.setSize("large");
    options.api.ui.dialog.replace(() => (
      <options.api.ui.DialogSelect
        title="OpenAI Accounts"
        placeholder="Search"
        options={menuOptions}
        onSelect={(option: TuiDialogSelectOption<MenuAction>) => {
          switch (option.value) {
            case "switch":
              void showSwitchDialog();
              break;
            case "usage-all":
              void showUsageDialog({ all: true });
              break;
            case "refresh-usage":
              void (async () => {
                try {
                  const results = await refreshUsage({ all: true });
                  options.succeed(
                    "Usage refreshed",
                    `Updated ${results.length} account(s).`,
                  );
                  options.api.ui.dialog.clear();
                } catch (error) {
                  options.fail("Usage refresh failed", error);
                }
              })();
              break;
            case "add-browser":
              void showAddBrowserDialog();
              break;
            case "add-device":
              void showAddDeviceDialog();
              break;
            case "import":
              void (async () => {
                try {
                  const account = await options.accounts.importCurrent();
                  await options.refreshSummary();
                  options.succeed("Account imported", accountLabel(account));
                  options.api.ui.dialog.clear();
                } catch (error) {
                  options.fail("Import failed", error);
                }
              })();
              break;
            case "remove":
              void showRemoveAccountDialog();
              break;
            case "refresh-state":
              void options.refreshSummary();
              options.api.ui.dialog.clear();
              break;
          }
        }}
      />
    ));
  };

  return {
    showUsageDialog,
    showRemoveAccountDialog,
    showSwitchDialog,
    showMainMenu,
  };
}
