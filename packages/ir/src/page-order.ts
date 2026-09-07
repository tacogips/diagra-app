import type { Page } from "./types.ts";

/** Unordered legacy pages precede ordered pages; ties always resolve by ID. */
export function comparePageOrder(left: Page, right: Page): number {
  const a = left.order ?? "";
  const b = right.order ?? "";
  return a < b
    ? -1
    : a > b
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;
}
