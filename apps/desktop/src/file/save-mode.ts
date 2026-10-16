export type SaveMode = "automatic" | "manual";
const KEY = "nodetto.file.save-mode";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function storageOrNull(storage?: PreferenceStorage): PreferenceStorage | null {
  try {
    return (
      storage ?? (typeof localStorage === "undefined" ? null : localStorage)
    );
  } catch {
    return null;
  }
}

export function loadSaveMode(storage?: PreferenceStorage): SaveMode {
  try {
    return storageOrNull(storage)?.getItem(KEY) === "manual"
      ? "manual"
      : "automatic";
  } catch {
    return "automatic";
  }
}

export function storeSaveMode(
  mode: SaveMode,
  storage?: PreferenceStorage,
): void {
  try {
    storageOrNull(storage)?.setItem(KEY, mode);
  } catch {
    // An unavailable preference store must not prevent saving documents.
  }
}
