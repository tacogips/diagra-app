import type { Element } from "@diagra/ir";

export const COLOR_FIELDS = ["fill", "stroke", "color"] as const;
export interface ColorUndo {
  id: string;
  field: (typeof COLOR_FIELDS)[number];
  beforeToken: string | undefined;
  beforeValue: string | undefined;
  afterToken: string | undefined;
}
export function captureColors(
  records: Map<string, ColorUndo>,
  before: Element,
  after: Element,
): void {
  for (const field of COLOR_FIELDS) {
    if (
      before.visual.colorTokens?.[field] ===
        after.visual.colorTokens?.[field] &&
      before.visual.style?.[field] === after.visual.style?.[field]
    )
      continue;
    const key = JSON.stringify([before.id, field]);
    const existing = records.get(key);
    records.set(key, {
      id: before.id,
      field,
      beforeToken: existing
        ? existing.beforeToken
        : before.visual.colorTokens?.[field],
      beforeValue: existing
        ? existing.beforeValue
        : before.visual.style?.[field],
      afterToken: after.visual.colorTokens?.[field],
    });
  }
}
