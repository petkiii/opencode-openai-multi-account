# OpenCode OpenAI Multi Account

OpenCode TUI plugin and CLI for keeping multiple local OpenAI/ChatGPT OAuth accounts and switching between them.

Main interface is the OpenCode TUI plugin. The package also ships the `ooma` CLI, which exposes the same account-management flow.

<img width="1343" height="485" alt="Account summary in TUI" src="https://github.com/user-attachments/assets/c4dd9940-abc1-4eab-8d22-761475c1ff50" />

## Install

Clone the repo:

```bash
git clone https://github.com/petkii/opencode-openai-multi-account.git
cd opencode-openai-multi-account
npm install
```

Add the TUI plugin to your OpenCode tui config `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-openai-multi-account"]
}
```

Install the CLI globally from the checkout if you also want the `ooma` command:

```bash
npm run install:global
```

This builds the CLI, then installs it globally and links the `ooma` command.

For development, run the CLI from source without global install:

```bash
npm run ooma -- list
```

## Usage

Open the account manager inside OpenCode TUI:

```text
/accounts
```

You can also use command palette and click `Manage accounts` or `Switch account`.

The CLI uses the `ooma` command:

```
ooma list
ooma import-current
ooma add
ooma select
ooma remove
ooma usage
ooma version
```

## How does it work?

The package keeps a sidecar account store at `~/.local/share/opencode-openai-multi-account/accounts.json` by default. Set `OPENCODE_MULTI_ACCOUNT_DATA_DIR` to use a different data directory.

OpenCode keeps its active auth config at `~/.local/share/opencode/auth.json` by default. Set `OPENCODE_DATA_DIR` if your OpenCode data directory lives somewhere else. OpenCode config itself usually lives under `~/.config/opencode/`.

When you select an account, this package refreshes its OAuth access token if needed, then writes that account into OpenCode's canonical `auth.json["openai"]` OAuth record. OpenCode hot-swaps auth config, so the next OpenCode request uses the selected account without restarting OpenCode.

Usage data is fetched from `https://chatgpt.com/backend-api/wham/usage` with the selected account access token.

OAuth access and refresh tokens are stored in local JSON files. Treat the OpenCode and multi-account data directories as sensitive.

## NOTE

Heavily videcoded, no guarantees.
