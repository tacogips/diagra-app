import { expect, test } from "bun:test";
import { prepareDocumentClose } from "./close.ts";

test("closing waits for flush before checking unsaved changes", async () => {
  let dirty = true;
  let asked = false;
  const session = {
    flush: async () => {
      await Promise.resolve();
      dirty = false;
      return true;
    },
    state: () => ({ dirty }) as import("./session.ts").SessionState,
  };
  expect(
    await prepareDocumentClose(session, async () => {
      asked = true;
      return false;
    }),
  ).toBe(true);
  expect(asked).toBe(false);
});

test("manual or failed saves require a discard decision before closing", async () => {
  const session = {
    flush: async () => false,
    state: () => ({ dirty: true }) as import("./session.ts").SessionState,
  };
  expect(await prepareDocumentClose(session, async () => false)).toBe(false);
  expect(await prepareDocumentClose(session, async () => true)).toBe(true);
});
