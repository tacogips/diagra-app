import { expect, test } from "bun:test";
import { isRasterDataUrl, MAX_IMAGE_BYTES } from "./image.ts";

test("image limit is measured in decoded bytes at the exact boundary", () => {
  const image = Buffer.alloc(MAX_IMAGE_BYTES);
  image.set([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(
    isRasterDataUrl(`data:image/png;base64,${image.toString("base64")}`),
  ).toBe(true);
  const oversized = Buffer.concat([image, Buffer.from([0])]);
  expect(
    isRasterDataUrl(`data:image/png;base64,${oversized.toString("base64")}`),
  ).toBe(false);
});

test("declared image MIME must match its signature", () => {
  for (const [mime, bytes] of [
    ["png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["jpeg", [255, 216, 255, 224]],
    ["gif", [71, 73, 70, 56, 57, 97]],
    ["webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ] as const) {
    const encoded = Buffer.from(bytes).toString("base64");
    expect(isRasterDataUrl(`data:image/${mime};base64,${encoded}`)).toBe(true);
    const wrong = mime === "png" ? "jpeg" : "png";
    expect(isRasterDataUrl(`data:image/${wrong};base64,${encoded}`)).toBe(
      false,
    );
  }
});

test("malformed base64 and disguised non-image content are rejected", () => {
  for (const encoded of [
    "A",
    "AAA",
    "AA=A",
    "AAAA===",
    "iVBORw0KGgo=\n",
    "iVBORw0KGgp=",
    "PHN2Zz4=",
    "AAAA",
  ]) {
    expect(isRasterDataUrl(`data:image/png;base64,${encoded}`)).toBe(false);
  }
});
