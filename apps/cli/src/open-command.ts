import { type CommandIo, fail, ok, parseArgs } from "./commands.ts";
import { helpFor } from "./help.ts";

export async function openCommand(io: CommandIo, args: readonly string[]) {
  const parsed = parseArgs(args, new Set(["--app"]), new Set());
  if (typeof parsed === "string") return fail(parsed);
  const path = parsed.positional[0];
  if (!path || parsed.positional.length !== 1)
    return fail(`open expects exactly one file path.\n\n${helpFor("open")}`);
  if (!io.openDocument) return fail("Desktop launching is unavailable.");
  try {
    await io.openDocument(path, parsed.options.get("--app"));
    return ok(`Open requested: ${path}\n`);
  } catch (cause) {
    return fail(
      `Cannot open ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
