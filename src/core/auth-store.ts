import { readJsonFile, writeJsonAtomic } from "./fs.js";
import type {
  AuthFile,
  OAuthAuth,
  OpenCodeAuth,
  StoredAccount,
} from "./types.js";

const OPENAI_PROVIDER_ID = "openai";

export async function readAuthFile(filePath: string): Promise<AuthFile> {
  return readJsonFile<AuthFile>(filePath, {});
}

export async function getCanonicalOpenAIAuth(
  filePath: string,
): Promise<OpenCodeAuth | undefined> {
  const data = await readAuthFile(filePath);
  return data[OPENAI_PROVIDER_ID];
}

export function isOAuthAuth(auth: OpenCodeAuth | undefined): auth is OAuthAuth {
  return auth?.type === "oauth";
}

export function oauthAuthMatchesStoredAccount(
  auth: OpenCodeAuth | undefined,
  account: StoredAccount,
): boolean {
  if (!isOAuthAuth(auth)) return false;
  return (
    auth.refresh === account.refreshToken || auth.access === account.accessToken
  );
}

export function storedAccountToOAuthAuth(account: StoredAccount): OAuthAuth {
  return {
    type: "oauth",
    refresh: account.refreshToken,
    access: account.accessToken,
    expires: account.expiresAt,
    ...(account.accountId ? { accountId: account.accountId } : {}),
    ...(account.enterpriseUrl ? { enterpriseUrl: account.enterpriseUrl } : {}),
  };
}

export async function writeCanonicalOpenAIAuth(
  filePath: string,
  auth: OAuthAuth,
): Promise<void> {
  const data = await readAuthFile(filePath);
  await writeJsonAtomic(filePath, {
    ...data,
    [OPENAI_PROVIDER_ID]: auth,
  });
}

export async function removeCanonicalOpenAIAuth(
  filePath: string,
): Promise<void> {
  const data = await readAuthFile(filePath);
  if (!(OPENAI_PROVIDER_ID in data)) return;

  const next = { ...data };
  delete next[OPENAI_PROVIDER_ID];
  await writeJsonAtomic(filePath, next);
}
