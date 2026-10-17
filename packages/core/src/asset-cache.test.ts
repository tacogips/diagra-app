import { expect, test } from "bun:test";
import { isRasterAttachmentPath, isRelativeAttachmentPath } from "@nodetto/ir";
import { AssetCache } from "./asset-cache.ts";
import { Editor } from "./editor.ts";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
test("attachment paths reject URLs, traversal, ambiguous encoding, absolute and Windows paths", () => {
  for (const path of [
    "../x.png",
    "artifacts/../x.png",
    "/x.png",
    "C:\\x.png",
    "https://example.com/x.png",
    "artifacts/%2e%2e/x.png",
    "artifacts/x.png?size=1",
    "./x.png",
    "artifacts//x.png",
    "artifacts/x.png\u0000",
    "artifacts/ x.png",
    "artifacts/x.png#ref",
  ])
    expect(isRelativeAttachmentPath(path)).toBe(false);
  for (const path of [
    "artifacts/abc.png",
    "images/photo 1.jpeg",
    "画像/図.webp",
  ])
    expect(isRasterAttachmentPath(path)).toBe(true);
  expect(isRelativeAttachmentPath("artifacts/source.html")).toBe(true);
  expect(isRasterAttachmentPath("artifacts/source.html")).toBe(false);
});
test("asset resolution remains ephemeral and document loads reset it without persisted edits", () => {
  const editor = new Editor();
  const id = editor.createElement("image.raster", {
    semantic: { src: "artifacts/icon.png", alt: "Icon" },
  });
  const before = editor.getSnapshot();
  let persisted = 0;
  let notifications = 0;
  editor.store.subscribe(() => persisted++);
  editor.subscribe(() => notifications++);
  editor.assets.set("artifacts/icon.png", PNG);
  expect(editor.assets.resolve("artifacts/icon.png")).toBe(PNG);
  expect(editor.getSnapshot()).toEqual(before);
  expect(editor.store.get(id)?.semantic).toEqual({
    src: "artifacts/icon.png",
    alt: "Icon",
  });
  expect(persisted).toBe(0);
  expect(notifications).toBe(1);
  editor.assets.set("artifacts/icon.png", PNG);
  expect(notifications).toBe(1);
  editor.loadDocument(before);
  expect(editor.assets.resolve("artifacts/icon.png")).toBeUndefined();
});
test("cache accepts legacy embedded sources but never unsafe or non-raster payloads", () => {
  const cache = new AssetCache();
  expect(cache.resolve(PNG)).toBe(PNG);
  expect(cache.resolve("https://example.com/a.png")).toBeUndefined();
  expect(() => cache.set("../x.png", PNG)).toThrow();
  expect(() =>
    cache.set("artifacts/a.png", "data:text/html;base64,WA=="),
  ).toThrow();
});
