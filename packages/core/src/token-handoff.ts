import type { TypographyStyleValue } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import { colorTokens } from "./color-tokens.ts";
import { numberTokens } from "./number-tokens.ts";
import { textStyles, TYPOGRAPHY_FIELDS } from "./text-styles.ts";
import { designTokenModes, pageTokenMode } from "./token-values.ts";

/** Encode every code point, avoiding collisions and unsafe user-controlled CSS. */
export function colorTokenCssName(id: string): string {
  return `--diagra-color-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
}

export function numberTokenCssName(id: string): string {
  return `--diagra-number-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
}

export function textStyleCssName(
  id: string,
  field: keyof TypographyStyleValue,
): string {
  return `--diagra-type-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}-${field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

export function typographyCssValue(
  field: keyof TypographyStyleValue,
  value: TypographyStyleValue[keyof TypographyStyleValue],
): string {
  if (field === "fontFamily")
    return `"${String(value).replace(/[\"\n\r\f<>]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}"`;
  if (field === "fontSize" || field === "letterSpacing") return `${value}px`;
  if (field === "fontVariations" || field === "fontFeatures")
    return Array.isArray(value)
      ? value
          .flatMap((setting) =>
            typeof setting === "object" &&
            setting !== null &&
            "tag" in setting &&
            "value" in setting &&
            typeof setting.tag === "string" &&
            /^[A-Za-z0-9]{4}$/.test(setting.tag) &&
            typeof setting.value === "number" &&
            Number.isFinite(setting.value)
              ? [`"${setting.tag}" ${setting.value}`]
              : [],
          )
          .join(", ")
      : "normal";
  if (field === "textAlign")
    return value === "middle" ? "center" : String(value);
  return String(value);
}

export function typographyHandoff(editor: Editor) {
  const styles = textStyles(editor).map((style) => ({
    ...style,
    variables: Object.fromEntries(
      TYPOGRAPHY_FIELDS.flatMap((field) =>
        style.value[field] === undefined
          ? []
          : [[field, textStyleCssName(style.id, field)]],
      ),
    ),
  }));
  return {
    styles,
    css: `:root {\n${styles
      .flatMap((style) =>
        TYPOGRAPHY_FIELDS.flatMap((field) =>
          style.value[field] === undefined
            ? []
            : [
                `  ${textStyleCssName(style.id, field)}: ${typographyCssValue(field, style.value[field])};`,
              ],
        ),
      )
      .join("\n")}\n}`,
  };
}

/** Names remain JSON metadata, never executable CSS or unescaped CSS comments. */
export function paletteHandoff(editor: Editor) {
  const tokens = colorTokens(editor)
    .map((token) => ({
      id: token.id,
      name: token.name,
      value: token.value,
      baseValue: token.baseValue,
      aliasId: token.aliasId,
      modes: token.modes ?? [],
      broken: token.broken,
      cssVariable: colorTokenCssName(token.id),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    mode: pageTokenMode(editor.store, editor.currentPageId) ?? "Default",
    availableModes: designTokenModes(editor.store),
    tokens,
    css: `:root {\n${tokens.map((token) => `  ${token.cssVariable}: ${token.value};`).join("\n")}\n}`,
  };
}

export function measurementHandoff(editor: Editor) {
  const tokens = numberTokens(editor)
    .map((token) => ({
      id: token.id,
      name: token.name,
      value: token.value,
      baseValue: token.baseValue,
      aliasId: token.aliasId,
      modes: token.modes ?? [],
      broken: token.broken,
      cssVariable: numberTokenCssName(token.id),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    mode: pageTokenMode(editor.store, editor.currentPageId) ?? "Default",
    availableModes: designTokenModes(editor.store),
    tokens,
    css: `:root {\n${tokens.map((token) => `  ${token.cssVariable}: ${token.value}px;`).join("\n")}\n}`,
  };
}
