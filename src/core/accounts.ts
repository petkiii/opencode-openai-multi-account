import type { CredentialEntry } from "@opencode/client";
import type { ListedAccount } from "./types.js";
import { asString, isRecord } from "./utils.js";

export const OPENAI_INTEGRATION = "openai";
export const BROWSER_METHOD = "chatgpt-browser";
export const DEVICE_METHOD = "chatgpt-headless";
export const CHATGPT_METHOD = "chatgpt-token-sharing";

export function supportsUsage(method: string): boolean {
  return method === BROWSER_METHOD || method === DEVICE_METHOD;
}

export function isManagedMethod(method: string): boolean {
  return supportsUsage(method) || method === CHATGPT_METHOD;
}

// JWT claims are display hints only. Native OpenCode owns credential validation.
export function accountMetadata(access: string, metadata?: unknown) {
  let claims: Record<string, unknown> = {};
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(access.split(".")[1] ?? "", "base64url").toString(),
    );
    if (isRecord(decoded)) claims = decoded;
  } catch {
    // Opaque access tokens have no display metadata.
  }
  const profile = isRecord(claims["https://api.openai.com/profile"])
    ? claims["https://api.openai.com/profile"]
    : {};
  const auth = isRecord(claims["https://api.openai.com/auth"])
    ? claims["https://api.openai.com/auth"]
    : {};
  return {
    email: asString(claims.email) ?? asString(profile.email),
    userId: asString(auth.chatgpt_user_id) ?? asString(claims.sub),
    accountId:
      (isRecord(metadata) ? asString(metadata.accountID) : undefined) ??
      asString(auth.chatgpt_account_id) ??
      asString(claims.chatgpt_account_id),
  };
}

export function toAccount(
  credential: CredentialEntry,
): ListedAccount | undefined {
  const value = credential.value;
  if (
    credential.integrationID !== OPENAI_INTEGRATION ||
    value.type !== "oauth" ||
    !isManagedMethod(value.methodID)
  )
    return;
  return {
    id: credential.id,
    label: credential.label,
    ...accountMetadata(value.access, value.metadata),
    expiresAt: value.expires,
    selected: credential.active,
    usageSupported: supportsUsage(value.methodID),
  };
}
