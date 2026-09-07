import { expect, test } from "bun:test";
import {
  createShareUrl,
  parseShareFragment,
  shareTokenForRevocation,
} from "./share-link.ts";

const share = { docId: "doc-123", token: "abcdefghijklmnop123456" };

test("revocation accepts only a valid link for the current server and document", () => {
  const endpoint = "https://example.test/design";
  const link = createShareUrl(endpoint, share);
  expect(
    shareTokenForRevocation(` ${link} `, `${endpoint}/`, share.docId),
  ).toBe(share.token);
  for (const value of [
    createShareUrl(endpoint, { ...share, docId: "another-document" }),
    createShareUrl("https://other.test/design", share),
    createShareUrl("https://example.test/other", share),
    createShareUrl("http://example.test/design", share),
    link.replace("https://", "https://user:password@"),
    `${link}&token=${share.token}`,
    share.token,
    "x".repeat(4097),
  ])
    expect(shareTokenForRevocation(value, endpoint, share.docId)).toBeNull();
});

test("share links put credentials only in the fragment and preserve endpoint paths", () => {
  const url = new URL(
    createShareUrl("https://example.test/design?dev_user=owner#old", share),
  );
  expect(url.pathname).toBe("/design");
  expect(url.search).toBe("");
  expect(parseShareFragment(url.hash)).toEqual(share);
  expect(url.origin + url.pathname).not.toContain(share.token);
});

test("share links reject unsafe origins and malformed or ambiguous fragments", () => {
  for (const endpoint of [
    "javascript:alert(1)",
    "https://user:pass@example.test",
  ])
    expect(() => createShareUrl(endpoint, share)).toThrow();
  for (const fragment of [
    "",
    "#other=1",
    "#document=a&token=short",
    `#document=a&document=b&token=${share.token}`,
    `#document=a&token=${share.token}&token=${share.token}`,
    `#document=a%2Fb&token=${share.token}`,
    `#document=a%00b&token=${share.token}`,
    "#".repeat(2049),
  ])
    expect(parseShareFragment(fragment)).toBeNull();
});
