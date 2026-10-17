import { expect, test } from "bun:test";
import { decodeRasterDataUrl } from "@nodetto/ir";
import { HtmlImportAssets, htmlDependencyPath } from "./html-assets.ts";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
test("HTML and stylesheet dependencies normalize within the selected directory", () => {
  expect(htmlDependencyPath("../images/hero.png", "css/site.css")).toBe(
    "images/hero.png",
  );
  expect(htmlDependencyPath("./images/photo.png")).toBe("images/photo.png");
  for (const reference of [
    "../private.png",
    "../../private.png",
    "/secret.png",
    "https://example.com/a.png",
    "images/%2e%2e/private.png",
    "C:\\secret.png",
  ])
    expect(() => htmlDependencyPath(reference)).toThrow();
});
test("CSS background assets become local image files and deduplicate with image elements", async () => {
  const reads: string[] = [];
  const warnings: string[] = [];
  const assets = new HtmlImportAssets(async (path) => {
    reads.push(path);
    return decodeRasterDataUrl(PNG).bytes;
  });
  const css = await assets.css(
    'main { background-image:url("../images/hero.png"); }',
    "css/site.css",
    (message) => warnings.push(message),
  );
  expect(css).toContain(`url("${PNG}")`);
  const image = await assets.image("images/hero.png");
  expect(reads).toEqual(["images/hero.png"]);
  expect(assets.assets.size).toBe(1);
  expect(assets.pathForData(PNG)).toBe(image.path);
  expect(warnings).toEqual([]);
});
test("CSS URLs cannot fetch remote resources or escape the HTML directory", async () => {
  const warnings: string[] = [];
  const assets = new HtmlImportAssets(async () => {
    throw new Error("No filesystem reads should be attempted");
  });
  const css = await assets.css(
    ".remote {background:url(https://example.com/x.png)} .escape{background:url(../../secret.png)}",
    "css/site.css",
    (message) => warnings.push(message),
  );
  expect(css).not.toContain("url(");
  expect(warnings).toHaveLength(2);
  expect(assets.assets.size).toBe(0);
});
