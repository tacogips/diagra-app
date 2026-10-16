import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  WORKSPACES,
  type WorkspaceId,
  type SnapSettings,
} from "@nodetto/ui-solid";
import type { SaveMode } from "../file/save-mode.ts";
import type { CloudSettings } from "../cloud/settings.ts";
import "./settings.css";

type Category =
  | "general"
  | "canvas"
  | "snapping"
  | "files"
  | "cloud"
  | "shortcuts";
export interface SettingsDialogProps {
  readonly workspace: WorkspaceId;
  readonly onWorkspaceChange: (id: WorkspaceId) => void;
  readonly showGrid: boolean;
  readonly onShowGridChange: (show: boolean) => void;
  readonly showRulers: boolean;
  readonly onShowRulersChange: (show: boolean) => void;
  readonly leftPaneOpen: boolean;
  readonly rightPaneOpen: boolean;
  readonly onPaneChange: (side: "left" | "right", open: boolean) => void;
  readonly snap: SnapSettings;
  readonly onSnapChange: (snap: SnapSettings) => void;
  readonly filesAvailable: boolean;
  readonly saveMode: SaveMode;
  readonly onSaveModeChange: (mode: SaveMode) => void;
  readonly autosaveDelayMs: number;
  readonly onAutosaveDelayChange: (delay: number) => void;
  readonly filePath: string | null;
  readonly cloud?: CloudSettings;
  readonly onCloudChange: (settings: CloudSettings) => void;
  readonly onOpenCloud: () => void;
  readonly onClose: () => void;
}

export function SettingsDialog(props: SettingsDialogProps): JSX.Element {
  const [category, setCategory] = createSignal<Category>("general");
  let dialog: HTMLDialogElement | undefined;
  const categories = () =>
    [
      { id: "general", label: "General" },
      { id: "canvas", label: "Canvas" },
      { id: "snapping", label: "Snapping" },
      ...(props.filesAvailable ? [{ id: "files", label: "Files" }] : []),
      ...(props.cloud ? [{ id: "cloud", label: "Collaboration" }] : []),
      { id: "shortcuts", label: "Shortcuts" },
    ] as readonly { id: Category; label: string }[];
  onMount(() => {
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  });
  onCleanup(() => dialog?.close());
  const toggle = (
    label: string,
    checked: () => boolean,
    change: (on: boolean) => void,
  ) => (
    <label class="app-settings-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked()}
        onChange={(event) => change(event.currentTarget.checked)}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      class="app-settings-dialog"
      aria-labelledby="app-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header>
        <h2 id="app-settings-title">Settings</h2>
        <button
          type="button"
          aria-label="Close settings"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>
      <div class="app-settings-layout">
        <nav
          role="tablist"
          aria-label="Settings categories"
          aria-orientation="vertical"
          onKeyDown={(event) => {
            const items = categories();
            const index = items.findIndex((item) => item.id === category());
            let next = index;
            if (event.key === "ArrowDown") next = (index + 1) % items.length;
            else if (event.key === "ArrowUp")
              next = (index + items.length - 1) % items.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = items.length - 1;
            else return;
            event.preventDefault();
            const item = items[next];
            if (item) {
              setCategory(item.id);
              dialog
                ?.querySelector<HTMLElement>(`#app-settings-tab-${item.id}`)
                ?.focus();
            }
          }}
        >
          <For each={categories()}>
            {(item) => (
              <button
                type="button"
                role="tab"
                id={`app-settings-tab-${item.id}`}
                aria-controls="app-settings-panel"
                aria-selected={category() === item.id}
                tabIndex={category() === item.id ? 0 : -1}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
        <section
          id="app-settings-panel"
          role="tabpanel"
          aria-labelledby={`app-settings-tab-${category()}`}
          tabindex={0}
        >
          <h3>{categories().find((item) => item.id === category())?.label}</h3>
          <Show when={category() === "general"}>
            <label class="app-settings-row">
              <span>Mode</span>
              <select
                aria-label="Default editing mode"
                value={props.workspace}
                onChange={(event) =>
                  props.onWorkspaceChange(
                    event.currentTarget.value as WorkspaceId,
                  )
                }
              >
                <For each={WORKSPACES}>
                  {(workspace) => (
                    <option value={workspace.id}>{workspace.label}</option>
                  )}
                </For>
              </select>
            </label>
          </Show>
          <Show when={category() === "canvas"}>
            {toggle("Grid", () => props.showGrid, props.onShowGridChange)}
            {toggle("Rulers", () => props.showRulers, props.onShowRulersChange)}
            {toggle(
              "Shapes and layers pane",
              () => props.leftPaneOpen,
              (open) => props.onPaneChange("left", open),
            )}
            {toggle(
              "Properties pane",
              () => props.rightPaneOpen,
              (open) => props.onPaneChange("right", open),
            )}
          </Show>
          <Show when={category() === "snapping"}>
            {toggle(
              "Snap to objects",
              () => props.snap.objects,
              (objects) => props.onSnapChange({ ...props.snap, objects }),
            )}
            {toggle(
              "Snap to grid",
              () => props.snap.grid,
              (grid) => props.onSnapChange({ ...props.snap, grid }),
            )}
            {toggle(
              "Snap to guides",
              () => props.snap.guides !== false,
              (guides) => props.onSnapChange({ ...props.snap, guides }),
            )}
          </Show>
          <Show when={category() === "files"}>
            <label class="app-settings-row">
              <span>File saving</span>
              <select
                aria-label="File saving"
                value={props.saveMode}
                onChange={(event) =>
                  props.onSaveModeChange(
                    event.currentTarget.value === "manual"
                      ? "manual"
                      : "automatic",
                  )
                }
              >
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label class="app-settings-row">
              <span>Autosave delay</span>
              <select
                aria-label="Autosave delay"
                value={props.autosaveDelayMs}
                onChange={(event) =>
                  props.onAutosaveDelayChange(Number(event.currentTarget.value))
                }
              >
                <option value="500">0.5 seconds</option>
                <option value="1000">1 second</option>
                <option value="3000">3 seconds</option>
                <option value="5000">5 seconds</option>
              </select>
            </label>
            <Show when={props.filePath}>
              <div class="app-settings-path">
                <strong>Current file</strong>
                <p>{props.filePath}</p>
              </div>
            </Show>
          </Show>
          <Show when={category() === "cloud" && props.cloud}>
            {(cloud) => {
              const current = () => cloud() as CloudSettings;
              return (
                <>
                  <label class="app-settings-row">
                    <span>Display name</span>
                    <input
                      aria-label="Display name"
                      value={current().userName}
                      onInput={(event) =>
                        props.onCloudChange({
                          ...current(),
                          userName: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label class="app-settings-row">
                    <span>Cursor color</span>
                    <input
                      aria-label="Cursor color"
                      type="color"
                      value={current().userColor}
                      onInput={(event) =>
                        props.onCloudChange({
                          ...current(),
                          userColor: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label class="app-settings-row">
                    <span>Server URL</span>
                    <input
                      aria-label="Server URL"
                      type="url"
                      value={current().endpointUrl}
                      onChange={(event) =>
                        props.onCloudChange({
                          ...current(),
                          endpointUrl: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <button type="button" onClick={props.onOpenCloud}>
                    Open cloud connection
                  </button>
                </>
              );
            }}
          </Show>
          <Show when={category() === "shortcuts"}>
            <table class="app-settings-shortcuts">
              <tbody>
                <For
                  each={[
                    ["Pan", "Right-click + drag"],
                    ["Temporary hand", "Space + drag"],
                    ["Select", "V"],
                    ["Hand", "H"],
                    ["Open", "Cmd+O (macOS)"],
                    ["Save", "Cmd/Ctrl+S"],
                    ["Save as", "Cmd+Shift+S (macOS)"],
                    ["Reload", "Cmd+R (macOS)"],
                    ["Export", "Cmd/Ctrl+Shift+E"],
                    ["Undo", "Cmd/Ctrl+Z"],
                  ]}
                >
                  {(entry) => (
                    <tr>
                      <th>{entry[0]}</th>
                      <td>{entry[1]}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </section>
      </div>
    </dialog>
  );
}
