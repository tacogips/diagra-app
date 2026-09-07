import type { TextMark, TextMarkKind, TextNoteSemantic } from "@diagra/ir";

const MARK_ORDER: Readonly<Record<TextMarkKind, number>> = {
  bold: 0,
  italic: 1,
  code: 2,
  strike: 3,
  underline: 4,
  link: 5,
};

export interface RichTextSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly marks: readonly TextMark[];
}

/** Protocol allowlist shared by generated HTML, SVG and native code. */
export function safeTextLinkHref(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^(https?:|mailto:|tel:|\/|#)/i.test(trimmed) ? trimmed : null;
}

function markKey(mark: TextMark): string {
  return `${mark.kind}\u0000${mark.kind === "link" ? (mark.href ?? "") : ""}`;
}

function ordered(marks: readonly TextMark[]): readonly TextMark[] {
  return [...marks].sort(
    (left, right) =>
      left.start - right.start ||
      MARK_ORDER[left.kind] - MARK_ORDER[right.kind] ||
      (left.href ?? "").localeCompare(right.href ?? "") ||
      left.end - right.end,
  );
}

/** Defensive read for imported/forward-compatible semantic payloads. */
export function textNoteMarks(semantic: unknown): readonly TextMark[] {
  if (typeof semantic !== "object" || semantic === null) return [];
  const value = semantic as Partial<TextNoteSemantic>;
  const text = typeof value.text === "string" ? value.text : "";
  if (!Array.isArray(value.marks)) return [];
  return ordered(
    value.marks.filter(
      (mark): mark is TextMark =>
        typeof mark === "object" &&
        mark !== null &&
        Number.isInteger(mark.start) &&
        Number.isInteger(mark.end) &&
        mark.start >= 0 &&
        mark.end > mark.start &&
        mark.end <= text.length &&
        Object.hasOwn(MARK_ORDER, mark.kind),
    ),
  );
}

/** Clamp, sort and merge equivalent overlapping or adjacent marks. */
export function normalizeTextMarks(
  text: string,
  marks: readonly TextMark[],
): readonly TextMark[] {
  const normalized = ordered(
    marks.flatMap((mark) => {
      const start = Math.max(0, Math.min(text.length, Math.trunc(mark.start)));
      const end = Math.max(start, Math.min(text.length, Math.trunc(mark.end)));
      if (end <= start || !Object.hasOwn(MARK_ORDER, mark.kind)) return [];
      return [
        {
          start,
          end,
          kind: mark.kind,
          ...(mark.kind === "link" && mark.href ? { href: mark.href } : {}),
        },
      ];
    }),
  );
  const byKey = new Map<string, TextMark[]>();
  for (const mark of normalized) {
    const list = byKey.get(markKey(mark)) ?? [];
    const previous = list.at(-1);
    if (
      previous &&
      markKey(previous) === markKey(mark) &&
      mark.start <= previous.end
    ) {
      list[list.length - 1] = {
        ...previous,
        end: Math.max(previous.end, mark.end),
      };
    } else {
      list.push(mark);
    }
    byKey.set(markKey(mark), list);
  }
  return ordered([...byKey.values()].flat());
}

/**
 * Carry formatting through a plain-text edit using the unchanged prefix and
 * suffix as anchors. Marks spanning the edit keep spanning replacement text.
 */
export function rebaseTextMarks(
  previous: string,
  next: string,
  marks: readonly TextMark[],
): readonly TextMark[] {
  if (previous === next) return normalizeTextMarks(next, marks);
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix += 1;
  const oldEnd = previous.length - suffix;
  const newEnd = next.length - suffix;
  return rebaseMarksAtRange(next, marks, prefix, oldEnd, newEnd);
}

/** Replace an exact UTF-16 range without guessing edit boundaries from repeated text. */
export function replaceMarkedTextRange(
  previous: string,
  marks: readonly TextMark[],
  start: number,
  end: number,
  replacement: string,
) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > previous.length
  )
    throw new Error("Invalid text replacement range.");
  const text = previous.slice(0, start) + replacement + previous.slice(end);
  return {
    text,
    marks: rebaseMarksAtRange(
      text,
      marks,
      start,
      end,
      start + replacement.length,
    ),
  };
}

function rebaseMarksAtRange(
  next: string,
  marks: readonly TextMark[],
  prefix: number,
  oldEnd: number,
  newEnd: number,
): readonly TextMark[] {
  return normalizeTextMarks(
    next,
    moveMarksAtRange(marks, prefix, oldEnd, newEnd),
  );
}

/** Replace sorted, non-overlapping ranges, assembling text only once. */
export function replaceMarkedTextRanges(
  previous: string,
  marks: readonly TextMark[],
  ranges: readonly { readonly start: number; readonly end: number }[],
  replacement: string,
) {
  const pieces: string[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < cursor ||
      end < start ||
      end > previous.length
    )
      throw new Error("Invalid text replacement ranges.");
    pieces.push(previous.slice(cursor, start), replacement);
    cursor = end;
  }
  pieces.push(previous.slice(cursor));
  let moved = normalizeTextMarks(previous, marks);
  for (let at = ranges.length - 1; at >= 0; at -= 1) {
    const range = ranges[at];
    if (range)
      moved = moveMarksAtRange(
        moved,
        range.start,
        range.end,
        range.start + replacement.length,
      );
  }
  const text = pieces.join("");
  return { text, marks: normalizeTextMarks(text, moved) };
}

function moveMarksAtRange(
  marks: readonly TextMark[],
  prefix: number,
  oldEnd: number,
  newEnd: number,
): readonly TextMark[] {
  const delta = newEnd - oldEnd;
  const rebased = marks.flatMap((mark): readonly TextMark[] => {
    if (mark.end <= prefix) return [mark];
    if (mark.start >= oldEnd)
      return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];
    if (mark.start <= prefix && mark.end >= oldEnd)
      return [{ ...mark, end: mark.end + delta }];
    if (mark.start < prefix) return [{ ...mark, end: prefix }];
    if (mark.end > oldEnd)
      return [{ ...mark, start: newEnd, end: mark.end + delta }];
    return newEnd > prefix ? [{ ...mark, start: prefix, end: newEnd }] : [];
  });
  return rebased;
}

/** Toggle one mark over a non-empty UTF-16 range. */
export function toggleTextMarkRange(
  text: string,
  marks: readonly TextMark[],
  start: number,
  end: number,
  kind: TextMarkKind,
  href?: string,
): readonly TextMark[] {
  const from = Math.max(
    0,
    Math.min(text.length, Math.trunc(Math.min(start, end))),
  );
  const to = Math.max(
    from,
    Math.min(text.length, Math.trunc(Math.max(start, end))),
  );
  if (from === to) return normalizeTextMarks(text, marks);
  const candidate: TextMark = {
    start: from,
    end: to,
    kind,
    ...(kind === "link" && href?.trim() ? { href: href.trim() } : {}),
  };
  const key = markKey(candidate);
  const current = normalizeTextMarks(text, marks);
  const matching = current.filter((mark) => markKey(mark) === key);
  let coveredUntil = from;
  for (const mark of matching) {
    if (mark.end <= coveredUntil || mark.start > coveredUntil) continue;
    coveredUntil = Math.max(coveredUntil, mark.end);
  }
  const remove = coveredUntil >= to;
  const next = current.flatMap((mark): readonly TextMark[] => {
    const replaceLink = !remove && kind === "link" && mark.kind === "link";
    if (
      (!remove && !replaceLink) ||
      (remove && markKey(mark) !== key) ||
      mark.end <= from ||
      mark.start >= to
    )
      return [mark];
    return [
      ...(mark.start < from ? [{ ...mark, end: from }] : []),
      ...(mark.end > to ? [{ ...mark, start: to }] : []),
    ];
  });
  return normalizeTextMarks(text, remove ? next : [...next, candidate]);
}

export function textRangeHasMark(
  text: string,
  marks: readonly TextMark[],
  start: number,
  end: number,
  kind: TextMarkKind,
): boolean {
  const from = Math.max(
    0,
    Math.min(text.length, Math.trunc(Math.min(start, end))),
  );
  const to = Math.max(
    from,
    Math.min(text.length, Math.trunc(Math.max(start, end))),
  );
  if (from === to) return false;
  let coveredUntil = from;
  for (const mark of normalizeTextMarks(text, marks).filter(
    (candidate) => candidate.kind === kind,
  )) {
    if (mark.end <= coveredUntil || mark.start > coveredUntil) continue;
    coveredUntil = Math.max(coveredUntil, mark.end);
  }
  return coveredUntil >= to;
}

export function removeTextMarkRange(
  text: string,
  marks: readonly TextMark[],
  start: number,
  end: number,
  kind?: TextMarkKind,
): readonly TextMark[] {
  const from = Math.max(
    0,
    Math.min(text.length, Math.trunc(Math.min(start, end))),
  );
  const to = Math.max(
    from,
    Math.min(text.length, Math.trunc(Math.max(start, end))),
  );
  if (from === to) return normalizeTextMarks(text, marks);
  return normalizeTextMarks(
    text,
    normalizeTextMarks(text, marks).flatMap((mark): readonly TextMark[] => {
      if (
        (kind !== undefined && mark.kind !== kind) ||
        mark.end <= from ||
        mark.start >= to
      )
        return [mark];
      return [
        ...(mark.start < from ? [{ ...mark, end: from }] : []),
        ...(mark.end > to ? [{ ...mark, start: to }] : []),
      ];
    }),
  );
}

export function richTextSegments(
  semantic: unknown,
): readonly RichTextSegment[] {
  const value =
    typeof semantic === "object" && semantic !== null
      ? (semantic as Partial<TextNoteSemantic>)
      : {};
  const text = typeof value.text === "string" ? value.text : "";
  const marks = textNoteMarks(value);
  if (!text) return [];
  const boundaries = new Set([0, text.length]);
  for (const mark of marks) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1] ?? text.length;
    return {
      start,
      end,
      text: text.slice(start, end),
      marks: marks.filter((mark) => mark.start <= start && mark.end >= end),
    };
  });
}
