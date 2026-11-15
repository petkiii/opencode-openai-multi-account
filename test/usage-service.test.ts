import assert from "node:assert/strict";
import test from "node:test";
import { createUsageService } from "../src/core/usage-service.js";
import { createJwt } from "./helpers.js";

function fixture() {
  const state = {
    ids: ["active", "inactive", "bad"],
    resolveCalls: [] as string[],
    events: [] as string[],
    stored: new Map<string, unknown>(),
    now: 1_000_000,
  };
  const context = {
    integration: {
      get: async () => ({
        data: {
          connections: state.ids.map((id) => ({
            type: "credential",
            id,
            label: id,
            method: "oauth",
          })),
        },
      }),
      connection: {
        resolve: async (connection: { id: string }) => {
          state.resolveCalls.push(connection.id);
          if (connection.id === "bad")
            throw new Error("Refresh rejected with sensitive native details");
          // Native resolver supplies renewed credentials, including for inactive accounts.
          return {
            type: "oauth",
            methodID: "chatgpt-browser",
            refresh: "secret-refresh",
            access: createJwt({
              email: "user@example.com",
              chatgpt_account_id: connection.id,
            }),
            expires: state.now + 3600_000,
          };
        },
      },
    },
    storage: {
      get: async (key: string) => state.stored.get(key),
      set: async (key: string, value: unknown) => {
        state.stored.set(key, value);
      },
      remove: async (key: string) => {
        state.stored.delete(key);
      },
    },
  };
  const service = createUsageService(
    context as unknown as Parameters<typeof createUsageService>[0],
    async (id) => {
      state.events.push(id);
    },
    () => state.now,
  );
  return { service, state, context };
}

const payload = {
  plan_type: "plus",
  rate_limit: {
    primary_window: {
      limit_window_seconds: 18000,
      used_percent: 40,
      reset_at: 2_000_000_000,
    },
    secondary_window: { limit_window_seconds: 604800, used_percent: 60 },
  },
};

test("fetches usage using native-resolved credentials; isolates failures and blocks foreign IDs", async (t) => {
  const { service, state } = fixture();
  t.after(() => service.dispose());
  const requestedAccounts: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    const headers = new Headers(init.headers);
    assert.match(headers.get("Authorization")!, /^Bearer eyJ/);
    requestedAccounts.push(headers.get("ChatGPT-Account-Id")!);
    return Response.json(payload);
  });
  const results = await service.get({
    credentialIDs: ["active", "inactive", "bad", "foreign"],
    refresh: true,
  });
  assert.deepEqual(requestedAccounts.sort(), ["active", "inactive"]);
  assert.equal(results[0].snapshot?.windows[0].percentUsed, 40);
  assert.equal(results[1].snapshot?.planType, "plus");
  assert.match(results[2].error!, /refresh failed/);
  assert.match(results[3].error!, /not found/);
  assert.ok(!state.resolveCalls.includes("foreign"));
  assert.ok(!JSON.stringify(results).includes("sensitive"));
  assert.ok(
    !JSON.stringify([...state.stored.values()]).includes("secret-refresh"),
  );
  assert.deepEqual(state.events.sort(), ["active", "bad", "inactive"]);
});

test("coalesces concurrent refreshes and throttles repeated calls for ten seconds", async (t) => {
  const { service, state } = fixture();
  t.after(() => service.dispose());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    entered();
    await gate;
    return Response.json(payload);
  });
  const input = { credentialIDs: ["active"], refresh: true };
  const first = service.get(input);
  await ready;
  const second = service.get(input);
  release();
  assert.deepEqual(await first, await second);
  await service.get(input);
  assert.equal(requests, 1);
  state.now += 10_001;
  await service.get(input);
  assert.equal(requests, 2);
});

test("auth errors retain last snapshot and never rotate tokens independently", async (t) => {
  const { service, state } = fixture();
  t.after(() => service.dispose());
  let status = 200;
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    status === 200 ? Response.json(payload) : new Response(null, { status }),
  );
  const input = { credentialIDs: ["active"], refresh: true };
  const first = await service.get(input);
  state.now += 10_001;
  status = 401;
  const failed = await service.get(input);
  assert.deepEqual(
    failed[0].snapshot,
    JSON.parse(JSON.stringify(first[0].snapshot)),
  );
  assert.match(failed[0].error!, /Sign in again/);
  assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(await service.get({ ...input, refresh: false }), failed);
});

test("deletion during refresh discards snapshot and removes old cache", async (t) => {
  const { service, state } = fixture();
  t.after(() => service.dispose());
  t.mock.method(globalThis, "fetch", async () => {
    state.ids = [];
    return Response.json(payload);
  });
  const result = await service.get({
    credentialIDs: ["active"],
    refresh: true,
  });
  assert.match(result[0].error!, /removed/);
  assert.equal(state.stored.size, 0);
  assert.equal(state.events.length, 0);
});

test("plugin disposal aborts in-flight fetches without publishing or persisting", async (t) => {
  const { service, state } = fixture();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      service.dispose();
      init.signal!.throwIfAborted();
      throw new Error("unreachable");
    },
  );
  const result = await service.get({
    credentialIDs: ["active"],
    refresh: true,
  });
  assert.match(result[0].error!, /refresh failed/);
  assert.equal(state.stored.size, 0);
  assert.equal(state.events.length, 0);
});

test("unsupported OAuth methods never reach quota endpoint", async (t) => {
  const { service, context } = fixture();
  t.after(() => service.dispose());
  context.integration.connection.resolve = async () => ({
    type: "oauth",
    methodID: "chatgpt-token-sharing",
    access: "opaque",
    refresh: "secret",
    expires: Date.now() + 1000,
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not fetch");
  });
  const result = await service.get({
    credentialIDs: ["active"],
    refresh: true,
  });
  assert.match(result[0].error!, /Quota is unavailable/);
  assert.equal(fetch.mock.callCount(), 0);
});
