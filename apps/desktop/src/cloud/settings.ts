// Cloud connection settings.
//
// There is deliberately no default endpoint anywhere in this repository: the
// server half is a separate product, and a build of the open-source editor
// must never contact somebody else's host because a constant said so. The
// endpoint is something the user types, and until they do, cloud mode has
// nowhere to connect and says so.
//
// What is persisted is non-secret by construction — an endpoint, a display
// name, a colour, and (for local development against an unauthenticated
// server) a dev principal. Share-link tokens are entered per open and kept in
// memory only; `localStorage` in a webview is not a credential store.

export interface CloudSettings {
  /** Server origin, e.g. `http://localhost:8787`. Empty until configured. */
  readonly endpointUrl: string;
  readonly userName: string;
  /** CSS colour for this user's cursor. */
  readonly userColor: string;
  /** Dev principal (`?dev_user=`), honoured only by a dev server. */
  readonly devUser?: string;
}

const STORAGE_KEY = "diagra.cloud.settings";

/** Distinguishable at a glance, and readable on the canvas background. */
const CURSOR_COLORS = [
  "#335c67",
  "#9e2a2b",
  "#e09f3e",
  "#40916c",
  "#6d597a",
  "#1d3557",
] as const;

function pickColor(): string {
  const index = Math.floor(Math.random() * CURSOR_COLORS.length);
  return CURSOR_COLORS[index] ?? CURSOR_COLORS[0];
}

export function defaultCloudSettings(): CloudSettings {
  return { endpointUrl: "", userName: "Anonymous", userColor: pickColor() };
}

/** Storage may be unavailable (private mode, a sandboxed webview). */
function safeStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage;
  }
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCloudSettings(storage?: Storage): CloudSettings {
  const store = safeStorage(storage);
  const fallback = defaultCloudSettings();
  if (!store) {
    return fallback;
  }
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (raw === null) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CloudSettings>;
    return {
      endpointUrl:
        typeof parsed.endpointUrl === "string" ? parsed.endpointUrl : "",
      userName:
        typeof parsed.userName === "string" && parsed.userName.length > 0
          ? parsed.userName
          : fallback.userName,
      userColor:
        typeof parsed.userColor === "string" && parsed.userColor.length > 0
          ? parsed.userColor
          : fallback.userColor,
      ...(typeof parsed.devUser === "string" && parsed.devUser.length > 0
        ? { devUser: parsed.devUser }
        : {}),
    };
  } catch {
    // Corrupt settings are not worth a dialog: fall back and let the next
    // save overwrite them.
    return fallback;
  }
}

export function saveCloudSettings(
  settings: CloudSettings,
  storage?: Storage,
): void {
  const store = safeStorage(storage);
  if (!store) {
    return;
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked store costs the preference, not the session.
  }
}
