import { readFileSync } from "node:fs";

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageMetadata;

export const packageName =
  typeof packageJson.name === "string"
    ? packageJson.name
    : "opencode-openai-multi-account";

export const packageVersion =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

export const cliVersionLabel = `${packageName} ${packageVersion}`;
