import type { SnapSettings } from "@nodetto/ui-solid";

export interface EditorPreferences {
  readonly showGrid: boolean;
  readonly showRulers: boolean;
  readonly leftPaneOpen: boolean;
  readonly rightPaneOpen: boolean;
  readonly snap: SnapSettings;
  readonly autosaveDelayMs: number;
}
const KEY = "nodetto.editor.preferences.v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const defaults: EditorPreferences = {
  showGrid: true,
  showRulers: true,
  leftPaneOpen: true,
  rightPaneOpen: true,
  snap: { grid: true, objects: true, guides: true },
  autosaveDelayMs: 1000,
};
export function loadEditorPreferences(
  storage?: PreferenceStorage,
): EditorPreferences {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object")
      return {
        ...defaults,
        showRulers: storage?.getItem("nodetto.view.show-rulers") !== "false",
      };
    const value = raw as Record<string, unknown>;
    const snap =
      typeof value["snap"] === "object" && value["snap"] !== null
        ? (value["snap"] as Record<string, unknown>)
        : {};
    const bool = (
      key: "showGrid" | "showRulers" | "leftPaneOpen" | "rightPaneOpen",
    ) =>
      typeof value[key] === "boolean" ? (value[key] as boolean) : defaults[key];
    const delay = value["autosaveDelayMs"];
    return {
      showGrid: bool("showGrid"),
      showRulers: bool("showRulers"),
      leftPaneOpen: bool("leftPaneOpen"),
      rightPaneOpen: bool("rightPaneOpen"),
      snap: {
        grid: typeof snap["grid"] === "boolean" ? snap["grid"] : true,
        objects: typeof snap["objects"] === "boolean" ? snap["objects"] : true,
        guides: typeof snap["guides"] === "boolean" ? snap["guides"] : true,
      },
      autosaveDelayMs:
        typeof delay === "number" &&
        Number.isFinite(delay) &&
        delay >= 100 &&
        delay <= 60000
          ? delay
          : 1000,
    };
  } catch {
    return defaults;
  }
}
export function storeEditorPreferences(
  preferences: EditorPreferences,
  storage?: PreferenceStorage,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(preferences));
  } catch {
    /* Preferences must not interrupt editing. */
  }
}
