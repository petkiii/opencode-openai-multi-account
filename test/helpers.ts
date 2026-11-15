import {
  OpenCode,
  type CredentialEntry,
  type IntegrationAttemptStatus,
} from "@opencode/client";
import { AccountManager } from "../src/core/service.js";
import type { UsageEntry } from "../src/plugin/rpc.js";

export function createJwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;
}

export function credential(id: string, active = false): CredentialEntry {
  return {
    id,
    integrationID: "openai",
    label: id,
    active,
    value: {
      type: "oauth",
      methodID: "chatgpt-browser",
      refresh: `secret-refresh-${id}`,
      access: createJwt({
        email: `${id}@example.com`,
        "https://api.openai.com/auth": { chatgpt_account_id: `org-${id}` },
      }),
      expires: Date.now() + 3600_000,
    },
  };
}

export function createHarness(
  initial = [credential("cred_a", true), credential("cred_b")],
) {
  const state = {
    credentials: initial,
    statuses: [{ status: "complete" }] as Array<
      Partial<IntegrationAttemptStatus>
    >,
    snapshots: [] as UsageEntry[],
    rpcAvailable: true,
    requests: [] as Array<{ method: string; path: string; body: any }>,
    onStatus: () => {},
  };
  const client = OpenCode.make({
    baseUrl: "http://test.local",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      state.requests.push({ method, path: url.pathname, body });
      if (url.pathname === "/api/credential")
        return Response.json({ data: state.credentials });
      if (url.pathname.startsWith("/api/rpc/")) {
        if (!state.rpcAvailable)
          return Response.json(
            {
              _tag: "RpcError",
              type: "rpc.unavailable",
              message: "missing plugin",
            },
            { status: 404 },
          );
        return Response.json({
          output: body.input.credentialIDs.map(
            (id: string) =>
              state.snapshots.find((entry) => entry.credentialID === id) ?? {
                credentialID: id,
              },
          ),
        });
      }
      if (url.pathname.endsWith("/activate")) {
        const id = url.pathname.split("/").at(-2);
        state.credentials.forEach((entry) => {
          entry.active = entry.id === id;
        });
        return new Response(null, { status: 204 });
      }
      if (url.pathname.startsWith("/api/credential/") && method === "DELETE") {
        const id = url.pathname.split("/").at(-1);
        const active = state.credentials.find(
          (entry) => entry.id === id,
        )?.active;
        state.credentials = state.credentials.filter(
          (entry) => entry.id !== id,
        );
        if (active && state.credentials[0]) state.credentials[0].active = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/connect/oauth") && method === "POST") {
        return Response.json({
          data: {
            attemptID: "attempt-test",
            url: "https://example.com/login",
            instructions: "Enter code",
            mode: "auto",
            time: { created: Date.now(), expires: Date.now() + 60_000 },
          },
        });
      }
      if (url.pathname.includes("/connect/oauth/")) {
        if (method === "DELETE") return new Response(null, { status: 204 });
        state.onStatus();
        const status =
          state.statuses.length > 1
            ? state.statuses.shift()
            : state.statuses[0];
        return Response.json({
          data: {
            ...status,
            time: { created: 0, expires: Date.now() + 60_000 },
          },
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    },
  });
  return {
    state,
    client,
    manager: new AccountManager(() => client, { directory: "/project" }),
  };
}
