import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizationFlow,
  extractAccountMetadata,
} from "../src/core/oauth.js";
import {
  createHarness,
  createJwt,
  FIXED_NOW,
} from "./helpers.js";

test("createAuthorizationFlow uses OpenCode localhost callback by default", async () => {
  const flow = await createAuthorizationFlow();

  assert.equal(flow.redirectUri, "http://localhost:1455/auth/callback");
  assert.match(
    flow.url,
    /redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback/,
  );
});

test("extractAccountMetadata reads email from OpenAI profile claims", () => {
  const metadata = extractAccountMetadata({
    access_token: createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "org-extra",
        chatgpt_user_id: "user-extra",
      },
    }),
    id_token: createJwt({
      "https://api.openai.com/profile": {
        email: "profile@example.com",
      },
      "https://api.openai.com/auth": {
        chatgpt_account_id: "org-extra",
        user_id: "user-extra",
      },
    }),
    refresh_token: "refresh-extra",
  });

  assert.equal(metadata.email, "profile@example.com");
  assert.equal(metadata.userId, "user-extra");
  assert.equal(metadata.accountId, "org-extra");
});

test("importCurrent mirrors canonical openai OAuth auth into sidecar store", async (t) => {
  const harness = await createHarness({ ids: ["acct-1"] });
  t.after(async () => {
    await harness.cleanup();
  });

  const accessToken = createJwt({
    email: "first@example.com",
    chatgpt_account_id: "org-first",
  });

  await harness.writeAuthFile({
    openai: {
      type: "oauth",
      refresh: "refresh-first",
      access: accessToken,
      expires: FIXED_NOW + 3_600_000,
      accountId: "org-first",
    },
  });

  const imported = await harness.manager.importCurrent();
  const store = await harness.readStore();
  const listed = await harness.manager.listAccounts();

  assert.equal(imported.id, "acct-1");
  assert.equal(store.selectedAccountId, "acct-1");
  assert.equal(store.accounts[0]?.email, "first@example.com");
  assert.equal(listed[0]?.selected, true);
  assert.equal(listed[0]?.email, "first@example.com");
});
