# OpenCode OpenAI Multi Account

An OpenCode v2 plugin that shows usage for your OpenAI accounts in the sidebar.
You can also add, remove, and switch accounts inside OpenCode.

<img width="1343" height="485" alt="Account summary in TUI" src="https://github.com/user-attachments/assets/c4dd9940-abc1-4eab-8d22-761475c1ff50" />

## Install

```bash
git clone https://github.com/petkiii/opencode-openai-multi-account.git
cd opencode-openai-multi-account
npm install
```

Add the plugin to `~/.config/opencode/opencode.json` or `.jsonc`:

```json
{
  "plugins": ["file:///absolute/path/to/opencode-openai-multi-account"]
}
```

Restart or reload OpenCode after adding the plugin.

## Usage

The sidebar shows your accounts, marks the active account, and displays the
remaining 5-hour and weekly quota. Click its heading to collapse or expand it.

Run `/accounts` or `/openai-accounts` to add, remove, or switch accounts and view
or refresh usage. You can also choose **Manage accounts** or **Switch account**
from the command palette.

Accounts added through OpenCode's `/connect` appear automatically. Codex browser
and device-code logins show quota percentages. ChatGPT logins show `??` for the
5-hour and weekly limits. API-key accounts are not shown.
