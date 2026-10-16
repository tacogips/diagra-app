import { randomBytes } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Replace `path` with `text` so that a crash or a full disk leaves either the
 * old file or the new one, never a truncated mix: write and flush a sibling
 * temporary file, then rename it over the target. A symlinked target is
 * resolved first so the link itself survives (a dangling link creates its
 * target, as a plain write would), and an existing file keeps its exact
 * permission bits.
 */
export function writeFileAtomic(path: string, text: string | Uint8Array): void {
  let target = path;
  let mode: number | null = null;
  try {
    target = realpathSync(path);
    mode = statSync(target).mode & 0o7777;
  } catch {
    // A new file, or a dangling symlink whose target does not exist yet.
    target = danglingTarget(path) ?? path;
  }
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const descriptor = openSync(temporary, "wx", mode ?? 0o666);
  try {
    try {
      // openSync filters the mode through the umask; restore it exactly.
      if (mode !== null) fchmodSync(descriptor, mode);
      const bytes =
        typeof text === "string"
          ? Buffer.from(text, "utf8")
          : Buffer.from(text);
      for (let offset = 0; offset < bytes.length; )
        offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target);
  } catch (cause) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already renamed or never created; nothing to clean up.
    }
    throw cause;
  }
  try {
    // Persist the rename itself; not every platform allows syncing a directory.
    const directory = openSync(dirname(target), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch {
    // Best effort only.
  }
}

/** Where a (chain of) dangling symlink(s) points, or null for a non-link. */
function danglingTarget(path: string): string | null {
  let current = path;
  for (let hops = 0; hops < 40; hops += 1) {
    try {
      if (!lstatSync(current).isSymbolicLink()) return current;
    } catch {
      return current === path ? null : current;
    }
    current = resolve(dirname(current), readlinkSync(current));
  }
  throw new Error(`Too many symbolic links: ${path}`);
}
