import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCliAsync } from "./cli.ts";
import type { CommandIo } from "./commands.ts";
import { desktopOpenArguments, openDesktopDocument } from "./open-desktop.ts";

const io: CommandIo = {
  readText: () => {
    throw new Error("Opening must not parse or write a document.");
  },
  writeText: () => {
    throw new Error("Opening must not write a document.");
  },
};

test("open delegates one file and an optional application without modifying it", async () => {
  const requests: unknown[] = [];
  const result = await runCliAsync(
    ["open", "a b.jsonl", "--app", "/tmp/Test.app"],
    {
      ...io,
      openDocument: async (...args) => {
        requests.push(args);
      },
    },
    "test",
  );
  expect(result.exitCode).toBe(0);
  expect(requests).toEqual([["a b.jsonl", "/tmp/Test.app"]]);
});

test("open rejects bad arguments and reports launch failures", async () => {
  for (const args of [[], ["a", "b"], ["a", "--unknown"], ["a", "--app"]]) {
    expect((await runCliAsync(["open", ...args], io, "test")).exitCode).toBe(2);
  }
  const result = await runCliAsync(
    ["open", "missing.jsonl"],
    {
      ...io,
      openDocument: async () => {
        throw new Error("app not installed");
      },
    },
    "test",
  );
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("app not installed");
});

test("open help never launches an app", async () => {
  for (const args of [
    ["open", "--help"],
    ["help", "open"],
  ]) {
    const result = await runCliAsync(args, io, "test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--app");
  }
});

test("launch plans preserve literal paths and use platform-specific executables", () => {
  const path = "-a name;$(touch nope).jsonl";
  expect(desktopOpenArguments(path, "/tmp/My App.app", "darwin")).toEqual([
    "/usr/bin/open",
    ["-a", "/tmp/My App.app", "--", resolve(path)],
  ]);
  expect(desktopOpenArguments(path, undefined, "linux")).toEqual([
    "nodetto",
    [resolve(path)],
  ]);
  expect(desktopOpenArguments(path, undefined, "win32")).toEqual([
    "nodetto.exe",
    [resolve(path)],
  ]);
  expect(() => desktopOpenArguments(path, undefined, "unsupported")).toThrow(
    "unsupported",
  );
});

test("missing files and directories are rejected before launching", async () => {
  const directory = mkdtempSync(`${tmpdir()}/nodetto-open-`);
  try {
    await expect(openDesktopDocument(directory)).rejects.toThrow(
      "regular file",
    );
    await expect(
      openDesktopDocument(`${directory}/missing.jsonl`),
    ).rejects.toThrow();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
