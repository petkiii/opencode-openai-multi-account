/** @jsxImportSource @opentui/solid */
import type { TuiSlotPlugin } from "@opencode-ai/plugin/tui";
import type { Accessor } from "solid-js";
import { For, Show } from "solid-js";
import {
  clipText,
  sidebarAccountDetail,
  sidebarAccountLabel,
} from "./labels.js";
import type { AccountSummary } from "./state.js";

interface SidebarOptions {
  summary: Accessor<AccountSummary>;
  collapsed: Accessor<boolean>;
  setCollapsed: (value: boolean) => void;
  openManager: () => void;
}

export function createSidebarPlugin(options: SidebarOptions): TuiSlotPlugin {
  return {
    order: 225,
    slots: {
      sidebar_content(ctx) {
        const current = options.summary();

        return (
          <box flexDirection="column">
            <box
              flexDirection="row"
              onMouseUp={() => options.setCollapsed(!options.collapsed())}
            >
              <text fg={ctx.theme.current.text}>
                <b>
                  {options.collapsed()
                    ? "▶ OpenAI Accounts"
                    : "▼ OpenAI Accounts"}
                </b>
                <Show when={options.collapsed()}>
                  {" "}
                  <span style={{ fg: ctx.theme.current.textMuted }}>
                    {`(${current.accounts.length})`}
                  </span>
                </Show>
              </text>
            </box>

            {current.error ? (
              <text fg={ctx.theme.current.warning}>
                {clipText(current.error, 52)}
              </text>
            ) : null}

            <Show when={!options.collapsed()}>
              <Show
                when={current.accounts.length > 0}
                fallback={
                  <text fg={ctx.theme.current.textMuted}>
                    No stored accounts.
                  </text>
                }
              >
                <For each={current.accounts}>
                  {(account) => (
                    <box
                      flexDirection="column"
                      gap={0}
                      onMouseUp={() => options.openManager()}
                    >
                      <text
                        fg={ctx.theme.current.secondary}
                        wrapMode="none"
                        overflow="hidden"
                      >
                        <span
                          style={{
                            fg: account.selected
                              ? ctx.theme.current.primary
                              : ctx.theme.current.textMuted,
                          }}
                        >
                          •
                        </span>{" "}
                        <span
                          style={{
                            fg: account.selected
                              ? ctx.theme.current.text
                              : ctx.theme.current.textMuted,
                          }}
                        >
                          {sidebarAccountLabel(account)}
                        </span>{" "}
                        <span style={{ fg: ctx.theme.current.textMuted }}>
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
    },
  };
}
