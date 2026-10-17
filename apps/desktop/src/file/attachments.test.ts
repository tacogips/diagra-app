import { expect, test } from "bun:test";
import { Editor } from "@nodetto/core";
import { decodeRasterDataUrl, type ImageSemantic } from "@nodetto/ir";
import { parseDocument } from "@nodetto/io";
import type { FileBackend } from "./backend.ts";
import { DocumentSession } from "./session.ts";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const reference = "artifacts/fixture.png";
function backend() {
  const files = new Map<string, string>();
  const attachments = new Map<string, Uint8Array>();
  const events: string[] = [];
  const host: FileBackend = {
    available: true,
    pickOpenPath: async () => null,
    pickSavePath: async () => "/first/design.jsonl",
    readDocument: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing document");
      return value;
    },
    writeDocument: async (path, text) => {
      events.push("document");
      files.set(path, text);
    },
    storeAttachment: async (path, _extension, bytes) => {
      events.push("asset");
      attachments.set(`${path}:${reference}`, bytes);
      return reference;
    },
    readAttachment: async (path, relative) => {
      const value = attachments.get(`${path}:${relative}`);
      if (!value) throw new Error("missing attachment");
      return value;
    },
    listRecent: async () => [],
    addRecent: async () => [],
    removeRecent: async () => [],
    watch: async () => {},
    unwatch: async () => {},
    onFileChanged: () => () => {},
  };
  return { host, files, attachments, events };
}
test("first save externalizes image bytes before JSONL and reopen resolves them without changing the document", async () => {
  const { host, files, events } = backend();
  const editor = new Editor();
  const id = editor.createElement("image.raster", {
    semantic: { src: PNG, alt: "Example" },
  });
  const session = new DocumentSession({
    editor,
    backend: host,
    saveMode: "manual",
  });
  const undo = editor.history.undoSize;
  expect(await session.save()).toBe(true);
  expect(events).toEqual(["asset", "document"]);
  const written = files.get("/first/design.jsonl")!;
  expect(written).not.toContain("data:image");
  expect(
    (parseDocument(written).elements[0]?.semantic as ImageSemantic).src,
  ).toBe(reference);
  expect(editor.assets.resolve(reference)).toBe(PNG);
  expect(editor.exportPageSvg()).toContain(PNG);
  expect(editor.history.undoSize).toBe(undo);
  expect(session.state().dirty).toBe(false);
  const reopened = new Editor();
  const second = new DocumentSession({
    editor: reopened,
    backend: host,
    saveMode: "manual",
  });
  expect(await second.openPath("/first/design.jsonl")).toBe(true);
  expect(reopened.assets.resolve(reference)).toBe(PNG);
  expect((reopened.store.get(id)?.semantic as ImageSemantic).src).toBe(
    reference,
  );
  expect(second.state().dirty).toBe(false);
  session.dispose();
  second.dispose();
});
test("Save As copies required bytes to another directory while preserving the source document", async () => {
  const { host, files, attachments } = backend();
  const editor = new Editor();
  editor.createElement("image.raster", {
    semantic: { src: PNG, alt: "Example" },
  });
  const session = new DocumentSession({
    editor,
    backend: host,
    saveMode: "manual",
  });
  await session.save();
  const before = files.get("/first/design.jsonl");
  host.pickSavePath = async () => "/second/copy.jsonl";
  expect(await session.saveAs()).toBe(true);
  expect(attachments.get(`/second/copy.jsonl:${reference}`)).toEqual(
    decodeRasterDataUrl(PNG).bytes,
  );
  expect(files.get("/first/design.jsonl")).toBe(before);
  expect(session.state().filePath).toBe("/second/copy.jsonl");
  session.dispose();
});
test("missing assets keep valid documents open but prevent saving a broken copy", async () => {
  const { host, files, events } = backend();
  const source = new Editor();
  source.createElement("image.raster", {
    semantic: { src: reference, alt: "Missing" },
  });
  const { serializeDocument } = await import("@nodetto/io");
  files.set("/source.jsonl", serializeDocument(source.getSnapshot()));
  const editor = new Editor();
  const session = new DocumentSession({
    editor,
    backend: host,
    saveMode: "manual",
  });
  expect(await session.openPath("/source.jsonl")).toBe(true);
  expect(session.state().error).toContain("missing attachment");
  expect(await session.saveAs()).toBe(false);
  expect(events).toEqual([]);
  expect(files.has("/first/design.jsonl")).toBe(false);
  session.dispose();
});
test("failed attachment writes never publish JSONL or replace embedded editor semantics", async () => {
  const { host, files } = backend();
  host.storeAttachment = async () => {
    throw new Error("disk full");
  };
  const editor = new Editor();
  const id = editor.createElement("image.raster", {
    semantic: { src: PNG, alt: "Example" },
  });
  const session = new DocumentSession({
    editor,
    backend: host,
    saveMode: "manual",
  });
  expect(await session.save()).toBe(false);
  expect(files.size).toBe(0);
  expect((editor.store.get(id)?.semantic as ImageSemantic).src).toBe(PNG);
  expect(session.state().error).toContain("disk full");
  session.dispose();
});
test("a document switch during asset preparation retires the pending JSONL write", async () => {
  const { host, files } = backend();
  let finish: (value: string) => void = () => {};
  host.storeAttachment = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const editor = new Editor();
  editor.createElement("image.raster", {
    semantic: { src: PNG, alt: "Example" },
  });
  const session = new DocumentSession({
    editor,
    backend: host,
    saveMode: "manual",
  });
  const saving = session.save();
  await Promise.resolve();
  await Promise.resolve();
  await session.newDocument();
  finish(reference);
  expect(await saving).toBe(false);
  expect(files.size).toBe(0);
  expect(editor.assets.resolve(reference)).toBeUndefined();
  session.dispose();
});
