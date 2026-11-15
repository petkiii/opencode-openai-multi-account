/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import type { SlotClaim } from "@opencode/plugin/tui/context";
import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";
import {
  clipText,
  sidebarAccountDetail,
  sidebarAccountLabel,
} from "./labels.js";
import type { AccountSummary } from "./state.js";

interface SidebarOptions {
  context: Plugin.Context;
  summary: Accessor<AccountSummary>;
  collapsed: Accessor<boolean>;
  setCollapsed: (value: boolean) => void;
  openManager: () => void;
}

export function createSidebarPlugin(
  options: SidebarOptions,
): SlotClaim<"sidebar.content"> {
  return {
    append: "sidebar.content",
    render() {
      const ctx = options.context;
      const current = options.summary;

      return (
        <box flexDirection="column">
          <box
            flexDirection="row"
            onMouseUp={() => options.setCollapsed(!options.collapsed())}
          >
            <text fg={ctx.theme.text.base}>
              <b>
                {options.collapsed()
                  ? "▶ OpenAI Accounts"
                  : "▼ OpenAI Accounts"}
              </b>
              <Show when={options.collapsed()}>
                {" "}
                <span style={{ fg: ctx.theme.text.muted }}>
                  {`(${current().accounts.length})`}
                </span>
              </Show>
            </text>
          </box>

          {current().error ? (
            <text fg={ctx.theme.text.feedback.warning.base}>
              {clipText(current().error ?? "", 52)}
            </text>
          ) : null}

          <Show when={!options.collapsed()}>
            <Show
              when={current().accounts.length > 0}
              fallback={
                <text fg={ctx.theme.text.muted}>No stored accounts.</text>
              }
            >
              <For each={current().accounts}>
                {(account) => (
                  <box
                    flexDirection="column"
                    gap={0}
                    onMouseUp={() => options.openManager()}
                  >
                    <text
                      fg={ctx.theme.text.base}
                      wrapMode="none"
                      overflow="hidden"
                    >
                      <span
                        style={{
                          fg: account.selected
                            ? ctx.theme.text.feedback.success.base
                            : ctx.theme.text.muted,
                        }}
                      >
                        •
                      </span>{" "}
                      <span
                        style={{
                          fg: account.selected
                            ? ctx.theme.text.base
                            : ctx.theme.text.muted,
                        }}
                      >
                        {sidebarAccountLabel(account)}
                      </span>{" "}
                      <span style={{ fg: ctx.theme.text.muted }}>
                        {sidebarAccountDetail(account)}
                      </span>
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </Show>
        </box>
      );
    },
  };
}
