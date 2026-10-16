// Entry point used by main.ts: the synchronous commands plus the ones that
// need to await (rendering), behind one dispatcher.

import { type CommandIo, type CommandResult, runCli } from "./commands.ts";
import { exportCommand } from "./export-command.ts";

const ASYNC_COMMANDS: Readonly<
  Record<
    string,
    (io: CommandIo, args: readonly string[]) => Promise<CommandResult>
  >
> = {
  export: exportCommand,
};

export async function runCliAsync(
  args: readonly string[],
  io: CommandIo,
  version: string,
): Promise<CommandResult> {
  const [command, ...rest] = args;
  const handler = command === undefined ? undefined : ASYNC_COMMANDS[command];
  const wantsHelp = rest.includes("--help") || rest.includes("-h");
  if (handler && !wantsHelp) return handler(io, rest);
  return runCli(args, io, version);
}
