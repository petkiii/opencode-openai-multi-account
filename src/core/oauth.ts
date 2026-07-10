import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  AuthorizationFlow,
  DeviceAuthorizationFlow,
  TokenResponse,
} from "./types.js";
import { fetchWithDeadline } from "./utils.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_DEVICE_AUTH_INTERVAL_MS = 5_000;
const DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS = 3_000;

export class AuthorizationCancelledError extends Error {
  constructor(message = "Login cancelled") {
    super(message);
    this.name = "AuthorizationCancelledError";
  }
}

export function isAuthorizationCancelledError(
  error: unknown,
): error is AuthorizationCancelledError {
  return error instanceof AuthorizationCancelledError;
}

interface ProfileClaims {
  email?: string;
}

export interface IdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  chatgpt_user_id?: string;
  user_id?: string;
  "https://api.openai.com/profile"?: ProfileClaims;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    chatgpt_user_id?: string;
    user_id?: string;
  };
}

function base64UrlEncode(value: Uint8Array | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = randomBytes(length);
  let output = "";
  for (const byte of bytes) {
    output += chars[byte % chars.length];
  }
  return output;
}

async function generatePkce(): Promise<
  Pick<AuthorizationFlow, "verifier" | "challenge">
> {
  const verifier = generateRandomString(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32));
}

export async function createAuthorizationFlow(
  options: { port?: number; redirectHost?: string } = {},
): Promise<AuthorizationFlow> {
  const port = options.port ?? 1455;
  const redirectHost = options.redirectHost ?? "localhost";
  const redirectUri = `http://${redirectHost}:${port}/auth/callback`;
  const { verifier, challenge } = await generatePkce();
  const state = generateState();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "opencode",
    state,
  });

  return {
    url: `${ISSUER}/oauth/authorize?${params.toString()}`,
    state,
    redirectUri,
    verifier,
    challenge,
  };
}

export async function createDeviceAuthorizationFlow(
): Promise<DeviceAuthorizationFlow> {
  const response = await fetchWithDeadline(
    `${ISSUER}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "opencode-openai-multi-account",
      },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    },
  );

  if (!response.ok) {
    throw new Error(`Device authorization failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    device_auth_id: string;
    user_code: string;
    interval?: string | number;
  };
  const interval = Number(data.interval);

  return {
    url: `${ISSUER}/codex/device`,
    userCode: data.user_code,
    deviceAuthId: data.device_auth_id,
    intervalMs:
      Number.isFinite(interval) && interval > 0
        ? interval * 1000
        : DEFAULT_DEVICE_AUTH_INTERVAL_MS,
  };
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as IdTokenClaims;
  } catch {
    return undefined;
  }
}

export function extractAccountIdFromClaims(
  claims: IdTokenClaims | undefined,
): string | undefined {
  if (!claims) return undefined;
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

export function extractUserIdFromClaims(
  claims: IdTokenClaims | undefined,
): string | undefined {
  if (!claims) return undefined;
  return (
    claims.chatgpt_user_id ||
    claims.user_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_user_id ||
    claims["https://api.openai.com/auth"]?.user_id
  );
}

export function extractEmailFromClaims(
  claims: IdTokenClaims | undefined,
): string | undefined {
  if (!claims) return undefined;
  return claims.email || claims["https://api.openai.com/profile"]?.email;
}

export function extractAccountMetadata(tokens: TokenResponse): {
  accountId?: string;
  userId?: string;
  email?: string;
} {
  const idClaims = tokens.id_token
    ? parseJwtClaims(tokens.id_token)
    : undefined;
  const accessClaims = parseJwtClaims(tokens.access_token);

  return {
    accountId:
      extractAccountIdFromClaims(idClaims) ||
      extractAccountIdFromClaims(accessClaims),
    userId:
      extractUserIdFromClaims(idClaims) ||
      extractUserIdFromClaims(accessClaims),
    email:
      extractEmailFromClaims(idClaims) || extractEmailFromClaims(accessClaims),
  };
}

export function parseAuthorizationInput(input: string): {
  code?: string;
  state?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) return {};

  try {
    const url = new URL(trimmed);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const params = new URLSearchParams(normalized);
    if (params.has("code")) {
      return {
        code: params.get("code") ?? undefined,
        state: params.get("state") ?? undefined,
      };
    }

    return { code: trimmed };
  }
}

export async function exchangeAuthorizationCode(
  code: string,
  flow: Pick<AuthorizationFlow, "redirectUri" | "verifier">,
  options: { signal?: AbortSignal } = {},
): Promise<TokenResponse> {
  const response = await fetchWithDeadline(
    `${ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: flow.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: flow.verifier,
      }).toString(),
    },
    options.signal,
  );

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function exchangeAuthorizationInput(
  input: string,
  flow: Pick<AuthorizationFlow, "redirectUri" | "verifier" | "state">,
): Promise<TokenResponse> {
  const parsed = parseAuthorizationInput(input);
  if (!parsed.code) {
    throw new Error("Authorization code missing from callback input.");
  }

  if (parsed.state && parsed.state !== flow.state) {
    throw new Error("Authorization state mismatch.");
  }

  return exchangeAuthorizationCode(parsed.code, flow);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetchWithDeadline(
    `${ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    },
  );

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function awaitDeviceAuthorization(
  flow: DeviceAuthorizationFlow,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TokenResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const throwIfCancelled = () => {
    if (options.signal?.aborted) {
      throw new AuthorizationCancelledError();
    }
  };

  while (Date.now() - startedAt < timeoutMs) {
    throwIfCancelled();

    const response = await fetchWithDeadline(
      `${ISSUER}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "opencode-openai-multi-account",
        },
        body: JSON.stringify({
          device_auth_id: flow.deviceAuthId,
          user_code: flow.userCode,
        }),
      },
      options.signal,
    );

    if (response.ok) {
      const data = (await response.json()) as {
        authorization_code: string;
        code_verifier: string;
      };

      return exchangeAuthorizationCode(
        data.authorization_code,
        {
          redirectUri: `${ISSUER}/deviceauth/callback`,
          verifier: data.code_verifier,
        },
        { signal: options.signal },
      );
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(
        `Device authorization polling failed: ${response.status}`,
      );
    }

    try {
      await sleep(
        flow.intervalMs + DEVICE_AUTH_POLLING_SAFETY_MARGIN_MS,
        undefined,
        { signal: options.signal },
      );
    } catch (error) {
      if (
        options.signal?.aborted &&
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw new AuthorizationCancelledError();
      }
      throw error;
    }
  }

  throw new Error("Device authorization timeout.");
}

const SUCCESS_HTML = `<!doctype html><html><body><h1>Authorization successful</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 1500)</script></body></html>`;

const errorHtml = (message: string): string =>
  `<!doctype html><html><body><h1>Authorization failed</h1><pre>${message}</pre></body></html>`;

export async function awaitOAuthCallback(
  flow: AuthorizationFlow,
  options: {
    listenHost?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TokenResponse> {
  const redirect = new URL(flow.redirectUri);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const port = Number(redirect.port || 80);
  const listenHost = options.listenHost ?? "127.0.0.1";

  return await new Promise<TokenResponse>((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", flow.redirectUri);

      if (url.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const detail = url.searchParams.get("error_description") || error;
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(errorHtml(detail));
        cleanup(new Error(detail));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(errorHtml("Missing authorization code."));
        cleanup(new Error("Missing authorization code."));
        return;
      }

      if (state !== flow.state) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(errorHtml("State mismatch."));
        cleanup(new Error("Authorization state mismatch."));
        return;
      }

      void exchangeAuthorizationCode(code, flow, {
        signal: options.signal,
      })
        .then((tokens) => {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(SUCCESS_HTML);
          cleanup(undefined, tokens);
        })
        .catch((error_) => {
          response.writeHead(500, { "Content-Type": "text/html" });
          response.end(
            errorHtml(
              error_ instanceof Error ? error_.message : String(error_),
            ),
          );
          cleanup(error_ instanceof Error ? error_ : new Error(String(error_)));
        });
    });

    const timer = setTimeout(() => {
      cleanup(new Error("OAuth callback timeout."));
    }, timeoutMs);

    const cleanup = (error?: Error, tokens?: TokenResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (server.listening) {
        server.close(() => undefined);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(tokens as TokenResponse);
    };

    const onAbort = () => {
      cleanup(new AuthorizationCancelledError());
    };

    if (options.signal?.aborted) {
      cleanup(new AuthorizationCancelledError());
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });

    server.on("error", (error) => {
      cleanup(error);
    });
    const onListen = () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        cleanup(new Error("OAuth callback server failed to start."));
      }
    };

    server.listen(port, listenHost, onListen);
  });
}
