import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

/** Argument arrays keep file names and application paths out of a shell. */
export function desktopOpenArguments(
  path: string,
  app: string | undefined,
  platform: string = process.platform,
): readonly [string, string[]] {
  const absolutePath = resolve(path);
  if (platform === "darwin")
    return ["/usr/bin/open", ["-a", app ?? "nodetto", "--", absolutePath]];
  if (platform === "linux" || platform === "win32")
    return [
      app ?? (platform === "win32" ? "nodetto.exe" : "nodetto"),
      [absolutePath],
    ];
  throw new Error(`Desktop launching is unsupported on ${platform}.`);
}

export async function openDesktopDocument(
  path: string,
  app?: string,
): Promise<void> {
  if (!statSync(path).isFile())
    throw new Error("The path must be a regular file.");
  const [command, args] = desktopOpenArguments(path, app);
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(command, args, {
      detached: process.platform !== "darwin",
      stdio: "ignore",
      shell: false,
    });
    child.once("error", reject);
    if (process.platform === "darwin") {
      // `open` exits immediately, but its exit code tells us if the app was found.
      child.once("exit", (code) => {
        if (code === 0) resolveLaunch();
        else
          reject(
            new Error(
              `macOS could not open the app (exit ${code}). Use --app to specify its name or path.`,
            ),
          );
      });
    } else {
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    }
  });
}
