// Short element ids for compact output, and resolution of user-supplied ids.
//
// Output uses the shortest prefix of at least MIN_PREFIX characters that is
// unique among the document's element ids (git-style). Input accepts a full
// id, a unique prefix, or "@ref" for an element created earlier in a batch.

export const MIN_PREFIX = 6;

/** Map each id to its shortest unique prefix (never shorter than MIN_PREFIX). */
export function shortIds(ids: readonly string[]): ReadonlyMap<string, string> {
  const sorted = [...new Set(ids)].sort();
  const result = new Map<string, string>();
  sorted.forEach((id, index) => {
    const neighbours = [sorted[index - 1], sorted[index + 1]].filter(
      (value): value is string => value !== undefined,
    );
    let length = Math.min(MIN_PREFIX, id.length);
    for (const other of neighbours) {
      let common = 0;
      while (
        common < id.length &&
        common < other.length &&
        id[common] === other[common]
      )
        common += 1;
      length = Math.max(length, Math.min(common + 1, id.length));
    }
    result.set(id, id.slice(0, length));
  });
  return result;
}

export type Resolution =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly message: string };

/** Resolve a full id, a unique prefix or an "@ref" against known ids. */
export function resolveId(
  query: string,
  ids: Iterable<string>,
  refs: ReadonlyMap<string, string> = new Map(),
): Resolution {
  if (query.startsWith("@")) {
    const id = refs.get(query.slice(1));
    return id === undefined
      ? { ok: false, message: `Unknown ref "${query}".` }
      : { ok: true, id };
  }
  const all = [...ids];
  if (all.includes(query)) return { ok: true, id: query };
  const matches = all.filter((id) => id.startsWith(query));
  if (matches.length === 1) return { ok: true, id: matches[0] as string };
  if (matches.length === 0)
    return { ok: false, message: `No element id starts with "${query}".` };
  return {
    ok: false,
    message: `"${query}" matches ${matches.length} elements; use a longer prefix.`,
  };
}
