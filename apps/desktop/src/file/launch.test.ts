import { expect, test } from "bun:test";
import { type LaunchBackend, openRequestedDocument } from "./launch.ts";

function queue(paths: string[]): LaunchBackend {
  return {
    takePaths: () => Promise.resolve(paths.splice(0)),
    onOpenRequested: () => () => {},
  };
}

test("opens the newest requested document once", async () => {
  const backend = queue(["/tmp/old.jsonl", "/tmp/new.jsonl"]);
  const opened: string[] = [];
  await openRequestedDocument(backend, (path) => opened.push(path));
  await openRequestedDocument(backend, (path) => opened.push(path));
  expect(opened).toEqual(["/tmp/new.jsonl"]);
});

test("does nothing when no document was requested", async () => {
  const opened: string[] = [];
  await openRequestedDocument(queue([]), (path) => opened.push(path));
  expect(opened).toEqual([]);
});
