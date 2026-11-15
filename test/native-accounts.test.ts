import assert from "node:assert/strict";
import test from "node:test";
import { credential, createHarness, createJwt } from "./helpers.js";
import { accountMetadata } from "../src/core/accounts.js";
import {
  accountDetail,
  sidebarAccountDetail,
} from "../src/plugin/tui/labels.js";

test("lists only supported native OpenAI OAuth credentials and redacts secret values", async () => {
  const key = {
    ...credential("key"),
    value: { type: "key" as const, key: "secret-api-key" },
  };
  const other = { ...credential("other"), integrationID: "anthropic" };
  const sharing = credential("sharing");
  if (sharing.value.type === "oauth")
    sharing.value.methodID = "chatgpt-token-sharing";
  const device = credential("device");
  if (device.value.type === "oauth") device.value.methodID = "chatgpt-headless";
  const { manager } = createHarness([
    credential("browser", true),
    device,
    key,
    other,
    sharing,
  ]);
  const accounts = await manager.listAccounts();
  assert.deepEqual(
    accounts.map((item) => item.id),
    ["browser", "device", "sharing"],
  );
  assert.equal(accounts[0].email, "browser@example.com");
  assert.equal(accounts[0].accountId, "org-browser");
  assert.equal(accounts[0].selected, true);
  const json = JSON.stringify(accounts);
  for (const secret of ["secret-", "refresh", "access", "value", "eyJ"])
    assert.ok(!json.includes(secret));
});

test("ChatGPT accounts show unknown quotas without requesting usage or refreshing tokens", async () => {
  const sharing = credential("chatgpt", true);
  if (sharing.value.type === "oauth") {
    sharing.value.methodID = "chatgpt-token-sharing";
    sharing.value.access = "opaque";
    sharing.value.expires = 0;
  }
  const { manager, state } = createHarness([sharing]);
  state.rpcAvailable = false;
  const [account] = await manager.listAccounts();
  assert.ok(account);
  assert.equal(account.selected, true);
  assert.equal(sidebarAccountDetail(account), "5h ?? · wk ??");
  assert.match(accountDetail(account, Date.now()), /^5h \?\? · wk \?\?/);
  const results = await manager.usage();
  assert.equal(results.length, 1);
  assert.equal(results[0].error, undefined);
  assert.equal(results[0].summary, undefined);
  assert.ok(
    state.requests.every((request) => request.path === "/api/credential"),
  );
  await manager.selectAccount(account.id);
  await manager.removeAccount(account.id);
  assert.deepEqual(await manager.listAccounts(), []);
});

test("mixed accounts request quotas only for Codex logins", async () => {
  const sharing = credential("chatgpt");
  if (sharing.value.type === "oauth")
    sharing.value.methodID = "chatgpt-token-sharing";
  const { manager, state } = createHarness([
    credential("codex", true),
    sharing,
  ]);
  state.snapshots = [
    {
      credentialID: "codex",
      snapshot: {
        fetchedAt: new Date().toISOString(),
        windows: [{ label: "5h", windowSeconds: 18000, percentUsed: 25 }],
      },
    },
  ];
  const accounts = await manager.listAccounts();
  assert.equal(sidebarAccountDetail(accounts[0]), "5h 75% · wk --");
  assert.equal(sidebarAccountDetail(accounts[1]), "5h ?? · wk ??");
  const results = await manager.usage();
  assert.equal(results[0].summary?.windows[0].percentUsed, 25);
  assert.equal(results[1].error, undefined);
  for (const request of state.requests.filter((request) =>
    request.path.startsWith("/api/rpc/"),
  )) {
    assert.deepEqual(request.body.input.credentialIDs, ["codex"]);
  }
});

test("opaque tokens retain native labels; metadata accountID takes precedence", () => {
  assert.deepEqual(accountMetadata("opaque"), {
    email: undefined,
    userId: undefined,
    accountId: undefined,
  });
  const token = createJwt({
    "https://api.openai.com/profile": { email: "profile@example.com" },
    "https://api.openai.com/auth": { chatgpt_account_id: "claim-org" },
  });
  assert.equal(
    accountMetadata(token, { accountID: "native-org" }).accountId,
    "native-org",
  );
  assert.equal(accountMetadata(token).email, "profile@example.com");
});

test("account actions use native credential IDs even when labels match", async () => {
  const { manager, state } = createHarness();
  state.credentials.forEach((entry) => {
    entry.label = "same";
  });
  await manager.selectAccount("cred_b");
  assert.equal(state.credentials.find((entry) => entry.active)?.id, "cred_b");
  assert.deepEqual(state.requests, [
    {
      method: "POST",
      path: "/api/credential/cred_b/activate",
      body: undefined,
    },
  ]);
});

test("removal follows native fallback and reports no managed selection for API-key fallback", async () => {
  const { manager, state } = createHarness();
  await manager.removeAccount("cred_a");
  assert.equal(
    (await manager.listAccounts()).find((entry) => entry.selected)?.id,
    "cred_b",
  );
  state.credentials.push({
    ...credential("api"),
    value: { type: "key", key: "secret" },
  });
  await manager.removeAccount("cred_b");
  assert.equal(
    (await manager.listAccounts()).find((entry) => entry.selected),
    undefined,
  );
  assert.equal(state.credentials[0].active, true);
});

test("usage keeps per-account errors and supports cached snapshots", async () => {
  const { manager, state } = createHarness();
  state.snapshots = [
    {
      credentialID: "cred_a",
      snapshot: {
        fetchedAt: new Date().toISOString(),
        windows: [{ label: "5h", windowSeconds: 18000, percentUsed: 25 }],
      },
    },
    {
      credentialID: "cred_b",
      error: "Usage authentication failed. Sign in again.",
    },
  ];
  const results = await manager.usage();
  assert.equal(results[0].summary?.windows[0].percentUsed, 25);
  assert.match(results[1].error!, /authentication failed/);
  assert.match(
    (await manager.listAccounts())[1].usageError!,
    /authentication failed/,
  );
  state.credentials.forEach((entry) => {
    entry.active = false;
  });
  assert.equal((await manager.usage()).length, 2);
});

test("sidebar account state follows changes made directly through native OpenCode", async () => {
  const { manager, client } = createHarness();
  assert.equal(
    (await manager.listAccounts()).find((entry) => entry.selected)?.id,
    "cred_a",
  );
  await client.credential.activate({ credentialID: "cred_b" });
  assert.equal(
    (await manager.listAccounts()).find((entry) => entry.selected)?.id,
    "cred_b",
  );
  await client.credential.remove({ credentialID: "cred_b" });
  assert.deepEqual(
    (await manager.listAccounts()).map((entry) => entry.id),
    ["cred_a"],
  );
});

test("usage service failure does not hide native accounts or block account actions", async () => {
  const { manager, state } = createHarness();
  state.rpcAvailable = false;
  const accounts = await manager.listAccounts();
  assert.equal(accounts.length, 2);
  assert.match(accounts[0].usageError!, /usage component unavailable/);
  await manager.selectAccount("cred_b");
  assert.equal(state.credentials.find((entry) => entry.active)?.id, "cred_b");
  await assert.rejects(manager.usage(), /usage component unavailable/);
  state.credentials = [];
  assert.deepEqual(await manager.listAccounts(), []);
});

for (const device of [false, true]) {
  test(`native ${device ? "device" : "browser"} login completes and releases attempt`, async () => {
    const { manager, state } = createHarness();
    const attempt = await manager.startAuthorization(device);
    await manager.waitAuthorization(attempt, new AbortController().signal);
    assert.equal(
      state.requests.find((entry) => entry.method === "POST")?.body.methodID,
      device ? "chatgpt-headless" : "chatgpt-browser",
    );
    assert.equal(state.requests.at(-1)?.method, "DELETE");
  });
}

for (const status of [
  { status: "failed", message: "Login denied" },
  { status: "expired" },
]) {
  test(`OAuth ${status.status} is surfaced and cancelled`, async () => {
    const { manager, state } = createHarness();
    state.statuses = [status as (typeof state.statuses)[number]];
    const attempt = await manager.startAuthorization(false);
    await assert.rejects(
      manager.waitAuthorization(attempt, new AbortController().signal),
      /Login denied|expired/,
    );
    assert.equal(state.requests.at(-1)?.method, "DELETE");
  });
}

test("cancellation during pending OAuth polling releases native attempt promptly", async () => {
  const { manager, state } = createHarness();
  const controller = new AbortController();
  state.statuses = [{ status: "pending" }];
  state.onStatus = () => controller.abort();
  const attempt = await manager.startAuthorization(false);
  await assert.rejects(manager.waitAuthorization(attempt, controller.signal), {
    name: "AbortError",
  });
  assert.equal(state.requests.at(-1)?.method, "DELETE");
});
