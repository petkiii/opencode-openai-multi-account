#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, argv, exit } from "node:process";
import { select as promptSelect } from "@inquirer/prompts";
import { Command } from "commander";
import { openBrowser } from "../core/browser.js";
import { accountDisplayName } from "../core/display.js";
import { AccountManager } from "../core/service.js";
import { awaitOAuthCallback } from "../core/oauth.js";
import { summarizeExpiry } from "../core/utils.js";
import { cliVersionLabel, packageVersion } from "../core/version.js";
import type { ListedAccount, StoredAccount } from "../core/types.js";
import {
  renderAccountTable,
  renderUsageTable,
  toPublicAccount,
  toUsageJson,
} from "./render.js";

interface JsonOption {
  json?: boolean;
}

interface AddOptions extends JsonOption {
  select?: boolean;
  deviceAuth?: boolean;
  manual?: boolean;
  browser?: boolean;
  callbackUrl?: string;
  code?: string;
  port?: string;
}

interface RemoveOptions extends JsonOption {
  replaceWith?: string;
}

function printJson(value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("--port must be a positive integer.");
  }
  return port;
}

async function reloadListedAccount(
  manager: AccountManager,
  account: StoredAccount,
  action: string,
): Promise<ListedAccount> {
  const listed = (await manager.listAccounts()).find(
    (entry) => entry.id === account.id,
  );
  if (!listed) throw new Error(`${action} account could not be reloaded.`);
  return listed;
}

function canPrompt(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY && !process.env.CI);
}

function accountChoiceDescription(
  account: ListedAccount,
  now = Date.now(),
): string {
  return [
    account.email ? `email=${account.email}` : undefined,
    account.userId ? `user=${account.userId}` : undefined,
    account.accountId ? `account=${account.accountId}` : undefined,
    `expires=${summarizeExpiry(account.expiresAt, now)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function chooseAccount(manager: AccountManager): Promise<string> {
  const accounts = await manager.listAccounts();
  if (!accounts.length) {
    throw new Error(
      "No stored accounts. Use 'ooma add' or 'ooma import-current' first.",
    );
  }
  if (!canPrompt()) {
    throw new Error(
      "Account selector is required when stdin/stdout are not interactive. Use 'ooma select <account>'.",
    );
  }

  const selected = await promptSelect({
    message: "Select OpenAI account",
    choices: accounts.map((account) => ({
      value: account.id,
      name: `${account.selected ? "*" : " "} ${accountDisplayName(account)} (${account.id.slice(0, 8)})`,
      description: accountChoiceDescription(account),
      short: accountDisplayName(account),
    })),
    default: accounts.find((account) => account.selected)?.id,
    pageSize: 10,
  });

  return selected;
}

async function run(): Promise<void> {
  const manager = new AccountManager();
  const program = new Command();

  program
    .name("ooma")
    .description("Manage stored OpenAI OAuth accounts for OpenCode")
    .version(packageVersion);

  program
    .command("version")
    .description("display version")
    .action(() => {
      stdout.write(`${cliVersionLabel}\n`);
    });

  program
    .command("list")
    .option("--json")
    .action(async (options: JsonOption) => {
      const accounts = await manager.listAccounts();
      if (options.json) {
        printJson(accounts.map(toPublicAccount));
        return;
      }
      stdout.write(`${renderAccountTable(accounts)}\n`);
    });

  program
    .command("import-current")
    .option("--select")
    .option("--json")
    .action(async (options: JsonOption & { select?: boolean }) => {
      const account = await manager.importCurrent({ select: options.select });
      const listed = await reloadListedAccount(manager, account, "Imported");
      if (options.json) {
        printJson(toPublicAccount(listed));
        return;
      }
      stdout.write(
        `Imported ${listed.id} (${listed.email ?? listed.userId ?? "unknown identity"}).\n`,
      );
    });

  program
    .command("add")
    .option("--select")
    .option("--device-auth")
    .option("--manual")
    .option("--no-browser")
    .option("--callback-url <url>")
    .option("--code <code>")
    .option("--port <n>")
    .option("--json")
    .action(async (options: AddOptions) => {
      const port = parsePort(options.port);
      const manual =
        options.manual || Boolean(options.callbackUrl || options.code);

      if (manual && options.deviceAuth) {
        throw new Error("--manual and --device-auth cannot be used together.");
      }

      if (options.deviceAuth) {
        const flow = await manager.createDeviceAuthorizationFlow();
        stdout.write(
          `Open this URL and enter code ${flow.userCode}:\n${flow.url}\n`,
        );
        const account = await manager.addAccountViaDeviceCode(flow, {
          select: options.select,
        });
        const listed = await reloadListedAccount(manager, account, "Added");
        if (options.json) {
          printJson(toPublicAccount(listed));
          return;
        }
        stdout.write(
          `Stored ${listed.id} (${listed.email ?? listed.userId ?? "unknown identity"}).\n`,
        );
        return;
      }

      if (manual) {
        const flow = await manager.createAuthorizationFlow({ port });
        stdout.write(`Open this URL to authorize:\n${flow.url}\n`);

        if (options.browser) {
          await openBrowser(flow.url);
        }

        const input =
          options.callbackUrl ||
          options.code ||
          (await prompt("Paste the callback URL or authorization code: "));
        const account = await manager.addAccountFromAuthorizationInput(
          flow,
          input,
          { select: options.select },
        );
        const listed = await reloadListedAccount(manager, account, "Added");
        if (options.json) {
          printJson(toPublicAccount(listed));
          return;
        }
        stdout.write(
          `Stored ${listed.id} (${listed.email ?? listed.userId ?? "unknown identity"}).\n`,
        );
        return;
      }

      const flow = await manager.createAuthorizationFlow({ port });
      stdout.write(`Authorize in your browser:\n${flow.url}\n`);
      if (!(await openBrowser(flow.url))) {
        stdout.write(`Browser open failed. Open the URL above manually.\n`);
      }

      const account = await manager.addAccountFromTokens(
        await awaitOAuthCallback(flow),
        { select: options.select },
      );
      const listed = await reloadListedAccount(manager, account, "Added");
      if (options.json) {
        printJson(toPublicAccount(listed));
        return;
      }
      stdout.write(
        `Stored ${listed.id} (${listed.email ?? listed.userId ?? "unknown identity"}).\n`,
      );
    });

  program
    .command("select")
    .argument("[account]")
    .option("--json")
    .action(async (selector: string | undefined, options: JsonOption) => {
      const account = await manager.selectAccount(
        selector ?? (await chooseAccount(manager)),
      );
      const listed = await reloadListedAccount(manager, account, "Selected");
      if (options.json) {
        printJson(toPublicAccount(listed));
        return;
      }
      stdout.write(
        `Selected ${listed.id}. The next OpenCode request will use this account.\n`,
      );
    });

  program
    .command("remove")
    .argument("<account>")
    .option("--replace-with <account>")
    .option("--json")
    .action(async (selector: string, options: RemoveOptions) => {
      const result = await manager.removeAccount(selector, options.replaceWith);
      if (options.json) {
        printJson({
          removed: result.removed.id,
          selected: result.selected?.id,
          clearedCanonicalAuth: result.clearedCanonicalAuth,
        });
        return;
      }
      stdout.write(`Removed ${result.removed.id}.\n`);
      if (result.selected) {
        stdout.write(`Selected ${result.selected.id} as replacement.\n`);
      } else if (result.clearedCanonicalAuth) {
        stdout.write(`Cleared canonical OpenCode openai OAuth auth.\n`);
      }
    });

  program
    .command("usage")
    .argument("[account]")
    .option("--all")
    .option("--json")
    .action(
      async (
        selector: string | undefined,
        options: JsonOption & { all?: boolean },
      ) => {
        const results = options.all
          ? await manager.usage({ all: true })
          : await manager.usage({ selector });
        if (options.json) {
          printJson(toUsageJson(results));
          return;
        }
        stdout.write(`${renderUsageTable(results)}\n`);
      },
    );

  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

run().catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
