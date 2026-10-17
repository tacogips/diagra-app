import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isRelativeAttachmentPath } from "@nodetto/ir";

/** Resolve against the input document, including after the caller changes cwd. */
export function readLocalAttachment(
  documentPath: string,
  attachment: string,
): Uint8Array {
  if (!isRelativeAttachmentPath(attachment))
    throw new Error("Invalid document-relative attachment path.");
  const root = realpathSync(resolve(dirname(documentPath)));
  const file = realpathSync(resolve(root, attachment));
  const child = relative(root, file);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(child)
  )
    throw new Error("Attachment escapes the document directory.");
  const limit = 32 * 1024 * 1024;
  const descriptor = openSync(file, "r");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= limit) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
      const read = readSync(descriptor, chunk, 0, chunk.length, null);
      if (!read) break;
      chunks.push(chunk.subarray(0, read));
      size += read;
    }
  } finally {
    closeSync(descriptor);
  }
  if (size > limit) throw new Error("Attachment exceeds 32 MiB.");
  return Buffer.concat(chunks);
}
