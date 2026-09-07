import type { DesignTokenSemantic } from "@diagra/ir";
import type { Command } from "./commands.ts";
import type { Editor } from "./editor.ts";
import { designTokenModes } from "./token-values.ts";

function validModeName(value: string): string | null {
  const name = value.trim();
  return name && name.toLowerCase() !== "default" ? name : null;
}

function hasMode(
  semantic: Partial<DesignTokenSemantic>,
  name: string,
): boolean {
  return (
    Array.isArray(semantic.modes) &&
    semantic.modes.some((mode) => mode.name === name)
  );
}

/** Rename one mode everywhere, preserving each page and token association. */
export function renameDesignTokenMode(
  editor: Editor,
  from: string,
  to: string,
): boolean {
  const source = validModeName(from);
  const target = validModeName(to);
  if (!source || !target || source === target) return false;
  if (designTokenModes(editor.store).includes(target)) return false;
  const context = editor.createShapeContext();
  const affected = editor.store
    .listElements()
    .filter(
      (element) =>
        element.type === "design.token" &&
        hasMode(element.semantic as Partial<DesignTokenSemantic>, source),
    );
  if (affected.some((element) => context.isLocked?.(element.id))) return false;
  const commands: Command[] = editor.store.listPages().flatMap((page) =>
    page.tokenMode === source
      ? [
          {
            type: "updatePage" as const,
            id: page.id,
            page: { tokenMode: target },
          },
        ]
      : [],
  );
  for (const element of affected) {
    const semantic = element.semantic as DesignTokenSemantic;
    commands.push({
      type: "updateSemantic",
      id: element.id,
      semantic: {
        ...semantic,
        modes: (Array.isArray(semantic.modes) ? semantic.modes : [])
          .map((mode) =>
            mode.name === source ? { ...mode, name: target } : mode,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
  }
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}

/** Remove one mode everywhere; affected pages atomically return to Default. */
export function removeDesignTokenMode(editor: Editor, name: string): boolean {
  const modeName = validModeName(name);
  if (!modeName) return false;
  const context = editor.createShapeContext();
  const affected = editor.store
    .listElements()
    .filter(
      (element) =>
        element.type === "design.token" &&
        hasMode(element.semantic as Partial<DesignTokenSemantic>, modeName),
    );
  if (affected.some((element) => context.isLocked?.(element.id))) return false;
  const commands: Command[] = editor.store.listPages().flatMap((page) =>
    page.tokenMode === modeName
      ? [
          {
            type: "updatePage" as const,
            id: page.id,
            page: { tokenMode: null },
          },
        ]
      : [],
  );
  for (const element of affected) {
    const semantic = element.semantic as DesignTokenSemantic;
    const modes = (Array.isArray(semantic.modes) ? semantic.modes : []).filter(
      (entry) => entry.name !== modeName,
    );
    const { modes: _oldModes, ...rest } = semantic;
    commands.push({
      type: "updateSemantic",
      id: element.id,
      semantic: {
        ...rest,
        ...(modes?.length ? { modes } : {}),
      },
    });
  }
  if (!commands.length) return false;
  editor.apply(commands);
  return true;
}
