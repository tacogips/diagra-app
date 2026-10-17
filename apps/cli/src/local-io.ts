import { existsSync, readFileSync } from "node:fs";
import type { CommandIo } from "./commands.ts";
import { readLocalAttachment } from "./attachments.ts";
import { openDesktopDocument } from "./open-desktop.ts";
import { writeFileAtomic } from "./write-atomic.ts";

/** Shared filesystem and desktop access for terminal and MCP commands. */
export function localIo(): CommandIo {
  return {
    readText: (path) => readFileSync(path, "utf8"),
    readAttachment: readLocalAttachment,
    openDocument: openDesktopDocument,
    readStdin: () => readFileSync(0, "utf8"),
    writeText: writeFileAtomic,
    writeBytes: writeFileAtomic,
    exists: (path) => existsSync(path),
  };
}
