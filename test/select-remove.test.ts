import assert from "node:assert/strict";
import test from "node:test";
import {
  createHarness,
  createJwt,
  FIXED_NOW,
} from "./helpers.js";

test("removeAccount switches to the requested replacement when deleting the selected account", async (t) => {
  const harness = await createHarness({ ids: ["acct-a", "acct-b"] });
  t.after(async () => {
    await harness.cleanup();
  });

  const first = await harness.manager.addAccountFromTokens(
    {
      access_token: createJwt({
        email: "one@example.com",
        chatgpt_account_id: "org-one",
      }),
      refresh_token: "refresh-one",
      expires_in: 3600,
    },
    { select: true },
  );
  const second = await harness.manager.addAccountFromTokens({
    access_token: createJwt({
      email: "two@example.com",
      chatgpt_account_id: "org-two",
    }),
    refresh_token: "refresh-two",
    expires_in: 3600,
  });

  const result = await harness.manager.removeAccount(first.id, second.id);
  const store = await harness.readStore();
  const authFile = await harness.readAuthFile();

  assert.equal(result.removed.id, first.id);
  assert.equal(result.selected?.id, second.id);
  assert.equal(store.selectedAccountId, second.id);
  assert.equal(store.accounts.length, 1);
  assert.equal(
    (authFile.openai as { access: string }).access,
    store.accounts[0]?.accessToken,
  );
});

test("removeAccount does not clear a later API-key based canonical auth", async (t) => {
  const harness = await createHarness({ ids: ["acct-api"] });
  t.after(async () => {
    await harness.cleanup();
  });

  const account = await harness.manager.addAccountFromTokens(
    {
      access_token: createJwt({
        email: "oauth@example.com",
        chatgpt_account_id: "org-oauth",
      }),
      refresh_token: "refresh-oauth",
      expires_in: 3600,
    },
    { select: true },
  );

  await harness.writeAuthFile({
    openai: {
      type: "api",
      key: "sk-live-example",
    },
  });

  const result = await harness.manager.removeAccount(account.id);
  const authFile = await harness.readAuthFile();
  const store = await harness.readStore();

  assert.equal(result.clearedCanonicalAuth, false);
  assert.equal((authFile.openai as { type: string }).type, "api");
  assert.equal(store.selectedAccountId, undefined);
});

test("removeAccount does not clear a later OAuth canonical auth for another account", async (t) => {
  const harness = await createHarness({ ids: ["acct-oauth"] });
  t.after(async () => {
    await harness.cleanup();
  });

  const account = await harness.manager.addAccountFromTokens(
    {
      access_token: createJwt({
        email: "oauth@example.com",
        chatgpt_account_id: "org-oauth",
      }),
      refresh_token: "refresh-oauth",
      expires_in: 3600,
    },
    { select: true },
  );

  await harness.writeAuthFile({
    openai: {
      type: "oauth",
      refresh: "refresh-other",
      access: createJwt({
        email: "other@example.com",
        chatgpt_account_id: "org-other",
      }),
      expires: FIXED_NOW + 3_600_000,
      accountId: "org-other",
    },
  });

  const result = await harness.manager.removeAccount(account.id);
  const authFile = await harness.readAuthFile();

  assert.equal(result.clearedCanonicalAuth, false);
  assert.equal((authFile.openai as { type: string }).type, "oauth");
  assert.equal(
    (authFile.openai as { refresh: string }).refresh,
    "refresh-other",
  );
});
