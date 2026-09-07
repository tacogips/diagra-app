import type {
  ColorTokenSemantic,
  Element,
  ElementId,
  NumberTokenSemantic,
} from "@diagra/ir";
import type { Store } from "./store.ts";

export interface TokenResolution<T> {
  readonly value: T;
  readonly aliased: boolean;
  readonly broken: boolean;
  readonly chain: readonly ElementId[];
}

type TokenKind = "color" | "number";
type TokenSemantic = ColorTokenSemantic | NumberTokenSemantic;
type RuntimeMode = {
  readonly name?: unknown;
  readonly value?: unknown;
  readonly alias?: unknown;
};

function modeEntry(
  semantic: TokenSemantic,
  mode: string | undefined,
): RuntimeMode | undefined {
  if (!mode || !Array.isArray(semantic.modes)) return undefined;
  return semantic.modes.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as RuntimeMode).name === mode,
  ) as RuntimeMode | undefined;
}

function tokenOf(
  store: Store,
  id: ElementId,
  kind: TokenKind,
): (Element & { readonly semantic: TokenSemantic }) | undefined {
  const element = store.get(id);
  return element?.type === "design.token" &&
    (element.semantic as { kind?: unknown }).kind === kind
    ? (element as Element & { readonly semantic: TokenSemantic })
    : undefined;
}

function validValue(kind: TokenKind, value: unknown): value is string | number {
  return kind === "color"
    ? typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    : typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function pageTokenMode(
  store: Store,
  pageId: string,
): string | undefined {
  const mode = store.getPage(pageId)?.tokenMode;
  return typeof mode === "string" && mode.toLowerCase() !== "default"
    ? mode
    : undefined;
}

export function activeTokenAlias(
  semantic: TokenSemantic,
  mode: string | undefined,
): ElementId | null {
  const entry = modeEntry(semantic, mode);
  if (entry?.value !== undefined) return null;
  const alias = entry?.alias ?? semantic.alias;
  return typeof alias === "string" && alias ? alias : null;
}

function resolveToken<T extends string | number>(
  store: Store,
  id: ElementId,
  kind: TokenKind,
  mode: string | undefined,
): TokenResolution<T> | null {
  const root = tokenOf(store, id, kind);
  if (!root || !validValue(kind, root.semantic.value)) return null;
  const fallback = root.semantic.value as T;
  const seen = new Set<ElementId>();
  const chain: ElementId[] = [];
  let current: ElementId = id;
  let aliased = false;
  while (true) {
    if (seen.has(current))
      return { value: fallback, aliased, broken: true, chain };
    seen.add(current);
    chain.push(current);
    const token = tokenOf(store, current, kind);
    if (!token) return { value: fallback, aliased, broken: true, chain };
    const entry = modeEntry(token.semantic, mode);
    if (entry?.value !== undefined) {
      if (validValue(kind, entry.value))
        return {
          value: entry.value as T,
          aliased,
          broken: false,
          chain,
        };
      return { value: fallback, aliased, broken: true, chain };
    }
    const alias = entry?.alias ?? token.semantic.alias;
    if (typeof alias === "string" && alias) {
      aliased = true;
      current = alias;
      continue;
    }
    if (validValue(kind, token.semantic.value))
      return {
        value: token.semantic.value as T,
        aliased,
        broken: false,
        chain,
      };
    return { value: fallback, aliased, broken: true, chain };
  }
}

export function resolveColorToken(
  store: Store,
  id: ElementId,
  pageId: string,
): TokenResolution<string> | null {
  return resolveToken<string>(store, id, "color", pageTokenMode(store, pageId));
}

export function resolveNumberToken(
  store: Store,
  id: ElementId,
  pageId: string,
): TokenResolution<number> | null {
  return resolveToken<number>(
    store,
    id,
    "number",
    pageTokenMode(store, pageId),
  );
}

/** All named modes remain discoverable even if only a page currently uses one. */
export function designTokenModes(store: Store): readonly string[] {
  const modes = new Set<string>();
  for (const page of store.listPages())
    if (typeof page.tokenMode === "string" && page.tokenMode)
      modes.add(page.tokenMode);
  for (const element of store.listElements()) {
    if (element.type !== "design.token") continue;
    const semantic = element.semantic as Partial<TokenSemantic>;
    if (!Array.isArray(semantic.modes)) continue;
    for (const mode of semantic.modes)
      if (typeof mode?.name === "string" && mode.name) modes.add(mode.name);
  }
  return [...modes].sort((a, b) => a.localeCompare(b));
}
