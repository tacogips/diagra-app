import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./write-atomic.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "diagra-cli-write-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("replaces an existing file, keeps its mode and leaves no temporary", () => {
  const path = join(directory, "doc.jsonl");
  writeFileSync(path, "old\n");
  chmodSync(path, 0o640);
  writeFileAtomic(path, "new\n");
  expect(readFileSync(path, "utf8")).toBe("new\n");
  expect(statSync(path).mode & 0o777).toBe(0o640);
  expect(readdirSync(directory)).toEqual(["doc.jsonl"]);
});

test("creates a new file", () => {
  const path = join(directory, "schema.sql");
  writeFileAtomic(path, "CREATE TABLE t (id int);\n");
  expect(readFileSync(path, "utf8")).toBe("CREATE TABLE t (id int);\n");
});

test("writes through a symlink instead of replacing it", () => {
  const real = join(directory, "real.jsonl");
  const link = join(directory, "link.jsonl");
  writeFileSync(real, "old\n");
  symlinkSync(real, link);
  writeFileAtomic(link, "new\n");
  expect(readFileSync(real, "utf8")).toBe("new\n");
  expect(readFileSync(link, "utf8")).toBe("new\n");
});

test("a failed write leaves the original untouched", () => {
  const path = join(directory, "missing-dir", "doc.jsonl");
  expect(() => writeFileAtomic(path, "new\n")).toThrow();
  const kept = join(directory, "doc.jsonl");
  writeFileSync(kept, "old\n");
  chmodSync(directory, 0o500);
  try {
    expect(() => writeFileAtomic(kept, "new\n")).toThrow();
    expect(readFileSync(kept, "utf8")).toBe("old\n");
  } finally {
    chmodSync(directory, 0o700);
  }
});

test("keeps permission bits the umask would strip", () => {
  const path = join(directory, "shared.sql");
  writeFileSync(path, "old\n");
  chmodSync(path, 0o664);
  const previous = process.umask(0o022);
  try {
    writeFileAtomic(path, "new\n");
  } finally {
    process.umask(previous);
  }
  expect(statSync(path).mode & 0o777).toBe(0o664);
});

test("a dangling symlink creates its target and stays a link", () => {
  const link = join(directory, "schema.sql");
  symlinkSync("generated.sql", link);
  writeFileAtomic(link, "create\n");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(directory, "generated.sql"), "utf8")).toBe(
    "create\n",
  );
});
