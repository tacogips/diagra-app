// codesign can change __LINKEDIT's virtual allocation even after removing its
// signature. Compare every remaining byte, normalizing only that allocation.
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function payload(path: string, temporary: string): Buffer {
  copyFileSync(path, temporary);
  const result = Bun.spawnSync(["codesign", "--remove-signature", temporary]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  const bytes = readFileSync(temporary);
  if (bytes.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error("Expected a 64-bit Mach-O executable");
  const count = bytes.readUInt32LE(16);
  let cursor = 32;
  for (let index = 0; index < count; index += 1) {
    const command = bytes.readUInt32LE(cursor);
    const size = bytes.readUInt32LE(cursor + 4);
    if (size < 8 || cursor + size > bytes.length)
      throw new Error("Invalid Mach-O load command");
    if (
      command === 0x19 &&
      bytes
        .subarray(cursor + 8, cursor + 24)
        .toString()
        .replace(/\0.*$/, "") === "__LINKEDIT"
    )
      bytes.fill(0, cursor + 32, cursor + 40);
    cursor += size;
  }
  return bytes;
}
const [staged, signed] = process.argv.slice(2);
if (!staged || !signed)
  throw new Error(
    "Usage: check-signed-payload.ts <verified-native-cli> <signed-bundle-cli>",
  );
const folder = mkdtempSync(join(tmpdir(), "nodetto-payload-"));
try {
  if (
    !payload(staged, join(folder, "staged")).equals(
      payload(signed, join(folder, "signed")),
    )
  )
    throw new Error("Bundled CLI differs from the verified native build");
  console.log("Verified signed native CLI payload.");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
