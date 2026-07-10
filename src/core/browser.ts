import { spawn } from "node:child_process";

export async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  return await new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });

      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (value) {
          child.unref();
        }
        resolve(value);
      };

      child.once("error", () => {
        finish(false);
      });

      child.once("spawn", () => {
        queueMicrotask(() => finish(true));
      });
    } catch {
      resolve(false);
    }
  });
}
