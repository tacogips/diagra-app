import { UmlComponentType } from "@nodetto/ir";
import { UmlComponentSection } from "./inspector/UmlComponentSection.tsx";
// The Inspector: a right-hand panel that reads the selection and writes
// commands (design editor-ux.md section 4).
//
// It holds no document state. Every section reads the element straight off
// the store through the editor signals and writes through `editor.apply`,
// so a remote edit re-renders the fields exactly like a local one. Keyboard
// events are stopped at the panel's root with native listeners: a letter
// typed into a field must never reach a canvas or window shortcut. History
// chords from non-editable controls may bubble to the shell's history owner.

import type { Editor } from "@nodetto/core";
import { leafElements, layerName, renameLayer } from "@nodetto/core";
import { BatchRenameSection } from "./inspector/BatchRenameSection.tsx";
import { ReplaceNoteTextSection } from "./inspector/ReplaceNoteTextSection.tsx";
import { BpmnSection } from "./inspector/BpmnSection.tsx";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@nodetto/ir";
import {
  createMemo,
  type JSX,
  lazy,
  Match,
  Show,
  Suspense,
  Switch,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import { stopPanelKeyDown } from "./panel-keyboard.ts";
import { GeometrySection } from "./inspector/GeometrySection.tsx";
import { SelectionGeometrySection } from "./inspector/SelectionGeometrySection.tsx";
import {
  AssociationSection,
  EdgeSection,
  FrameSection,
  GeoSection,
  GroupSection,
  NodeSection,
  PageSection,
  SequenceMessageSection,
  SequenceParticipantSection,
  TextNoteSection,
} from "./inspector/SimpleSections.tsx";
import { BasicAppearance } from "./inspector/BasicAppearance.tsx";
import { StyleSection } from "./inspector/StyleSection.tsx";
import { ImageSection } from "./inspector/ImageSection.tsx";
import { UmlClassSection } from "./inspector/UmlClassSection.tsx";
import { ColorBindingsSection } from "./inspector/ColorBindingsSection.tsx";
import { NumberBindingsSection } from "./inspector/NumberBindingsSection.tsx";
import { TextStyleBindingsSection } from "./inspector/TextStyleBindingsSection.tsx";
import { StrokeSection } from "./inspector/StrokeSection.tsx";
import { PathSection } from "./inspector/PathSection.tsx";
import { Field, Section, TextInput } from "./inspector/controls.tsx";

const ErdTableSection = lazy(() =>
  import("./inspector/ErdSections.tsx").then((module) => ({
    default: module.ErdTableSection,
  })),
);
const ErdRelationSection = lazy(() =>
  import("./inspector/ErdSections.tsx").then((module) => ({
    default: module.ErdRelationSection,
  })),
);
const OverridesSection = lazy(() =>
  import("./inspector/OverridesSection.tsx").then((module) => ({
    default: module.OverridesSection,
  })),
);
const AccessibilitySection = lazy(() =>
  import("./inspector/AccessibilitySection.tsx").then((module) => ({
    default: module.AccessibilitySection,
  })),
);

export interface InspectorFocus {
  readonly id: ElementId;
  /** A row of a table or class to scroll to and focus. */
  readonly row?: number;
}

export interface InspectorProps {
  readonly simple?: boolean;
  readonly editor: Editor;
  readonly focus?: InspectorFocus;
}

function stop(event: Event): void {
  event.stopPropagation();
}

/** Whether the geometry section applies: a positioned, non-edge element. */
function hasOwnGeometry(element: Element): boolean {
  return (
    element.type !== "group" &&
    getElementTypeDefinition(element.type)?.category !== "edge" &&
    element.visual.x !== undefined &&
    element.visual.y !== undefined
  );
}

export function Inspector(props: InspectorProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const selectedIds = createMemo<readonly ElementId[]>(() => [
    ...signals.selection(),
  ]);

  const leaves = createMemo<readonly Element[]>(() => {
    signals.rev();
    return leafElements(props.editor.store, signals.selection());
  });

  const single = createMemo<Element | null>(() => {
    signals.rev();
    const ids = selectedIds();
    const id = ids.length === 1 ? ids[0] : undefined;
    return id === undefined ? null : (props.editor.store.get(id) ?? null);
  });

  const page = createMemo(() => {
    signals.rev();
    return props.editor.store.getPage(props.editor.currentPageId) ?? null;
  });
  const focusRow = (): number | undefined => {
    const element = single();
    return element && props.focus?.id === element.id
      ? props.focus.row
      : undefined;
  };

  return (
    <aside
      class="nodetto-inspector"
      aria-label="Properties"
      on:keydown={stopPanelKeyDown}
      on:keyup={stop}
    >
      <Show
        when={(() => {
          signals.rev();
          return props.editor.readOnly;
        })()}
      >
        <p role="status">View only</p>
      </Show>
      <fieldset
        style={{ border: "none", margin: 0, padding: 0, "min-width": 0 }}
        disabled={(() => {
          signals.rev();
          if (props.editor.readOnly) return true;
          const context = props.editor.createShapeContext();
          return selectedIds().some((id) => context.isLocked?.(id));
        })()}
      >
        <Show when={selectedIds().length === 0}>
          <Show when={page()}>
            {(current) => (
              <PageSection editor={props.editor} page={current()} />
            )}
          </Show>
        </Show>

        <Show when={selectedIds().length > 1}>
          <p class="nodetto-inspector-summary">
            {`${selectedIds().length} elements selected`}
          </p>
        </Show>

        <Show when={single()}>
          {(element) => (
            <Switch>
              <Match when={element().type === "draw.freehand"}>
                <StrokeSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "draw.path"}>
                <PathSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "shape.geo"}>
                <GeoSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "node.generic"}>
                <NodeSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "sequence.participant"}>
                <SequenceParticipantSection
                  editor={props.editor}
                  element={element()}
                />
              </Match>
              <Match when={element().type === "sequence.message"}>
                <SequenceMessageSection
                  editor={props.editor}
                  element={element()}
                />
              </Match>
              <Match when={element().type === "image.raster"}>
                <ImageSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "frame"}>
                <FrameSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "text.note"}>
                <TextNoteSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "edge.generic"}>
                <EdgeSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "erd.table"}>
                <Suspense>
                  <ErdTableSection
                    editor={props.editor}
                    element={element()}
                    focusRow={focusRow()}
                  />
                </Suspense>
              </Match>
              <Match when={element().type === "erd.relation"}>
                <Suspense>
                  <ErdRelationSection
                    editor={props.editor}
                    element={element()}
                  />
                </Suspense>
              </Match>
              <Match
                when={Object.values(UmlComponentType).some(
                  (type) => element().type === type,
                )}
              >
                <UmlComponentSection
                  editor={props.editor}
                  element={element()}
                />
              </Match>
              <Match when={element().type === "uml.class"}>
                <UmlClassSection
                  editor={props.editor}
                  element={element()}
                  focusRow={focusRow()}
                />
              </Match>
              <Match when={element().type === "uml.association"}>
                <AssociationSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type.startsWith("bpmn.")}>
                <BpmnSection editor={props.editor} element={element()} />
              </Match>
              <Match when={element().type === "group"}>
                <GroupSection editor={props.editor} element={element()} />
              </Match>
            </Switch>
          )}
        </Show>

        <Show when={props.simple && leaves().length > 0}>
          <BasicAppearance editor={props.editor} leaves={leaves()} />
        </Show>
        <Show when={selectedIds().length > 0}>
          <details class="nodetto-inspector-details" open={!props.simple}>
            <summary hidden={!props.simple}>Advanced properties</summary>
            <Show when={single()}>
              {(element) => (
                <>
                  <Section title="Layer">
                    <Field label="Name">
                      <TextInput
                        label="Layer name"
                        value={element().visual.layerName ?? ""}
                        placeholder={layerName(element())}
                        onCommit={(name) =>
                          renameLayer(props.editor, element().id, name)
                        }
                      />
                    </Field>
                  </Section>
                  <Show when={hasOwnGeometry(element())}>
                    <GeometrySection
                      editor={props.editor}
                      element={element()}
                    />
                  </Show>
                </>
              )}
            </Show>
            <Show when={selectedIds().length > 1}>
              <SelectionGeometrySection editor={props.editor} />
            </Show>
            <Show when={leaves().length > 0}>
              <StyleSection editor={props.editor} leaves={leaves()} />
            </Show>

            <Show when={single()}>
              {(element) => (
                <>
                  <details class="nodetto-inspector-details">
                    <summary>Containing frame</summary>
                    <ParentSection editor={props.editor} element={element()} />
                  </details>
                  <details class="nodetto-inspector-details">
                    <summary>Accessibility</summary>
                    <Suspense>
                      <AccessibilitySection
                        editor={props.editor}
                        element={element()}
                      />
                    </Suspense>
                  </details>
                </>
              )}
            </Show>
          </details>
        </Show>
      </fieldset>
      <Show when={selectedIds().length > 0}>
        <details class="nodetto-inspector-details" open={!props.simple}>
          <summary hidden={!props.simple}>Shared styles</summary>
          <fieldset
            style={{ border: "none", margin: 0, padding: 0, "min-width": 0 }}
            disabled={(() => {
              signals.rev();
              return props.editor.readOnly;
            })()}
          >
            <ColorBindingsSection editor={props.editor} />
            <NumberBindingsSection editor={props.editor} />
            <TextStyleBindingsSection editor={props.editor} />
          </fieldset>
        </details>
      </Show>
      <Show
        when={
          selectedIds().length > 1 ||
          selectedIds().some(
            (id) => props.editor.store.get(id)?.type === "text.note",
          )
        }
      >
        <details class="nodetto-inspector-details">
          <summary>Rename and replace text</summary>
          <fieldset
            disabled={(() => {
              signals.rev();
              return props.editor.readOnly;
            })()}
            style={{ border: "none", padding: 0, margin: 0, "min-width": 0 }}
          >
            <Show when={selectedIds().length > 1}>
              <BatchRenameSection editor={props.editor} />
            </Show>
            <Show
              when={selectedIds().some(
                (id) => props.editor.store.get(id)?.type === "text.note",
              )}
            >
              <ReplaceNoteTextSection editor={props.editor} />
            </Show>
          </fieldset>
        </details>
      </Show>
      <Show when={single()}>
        <details class="nodetto-inspector-details" open={!props.simple}>
          <summary hidden={!props.simple}>Component settings</summary>
          <Show when={single()}>
            {(element) => (
              <Suspense>
                <fieldset
                  style={{
                    border: "none",
                    margin: 0,
                    padding: 0,
                    "min-width": 0,
                  }}
                  disabled={(() => {
                    signals.rev();
                    return props.editor.readOnly;
                  })()}
                >
                  <OverridesSection editor={props.editor} id={element().id} />
                </fieldset>
              </Suspense>
            )}
          </Show>
        </details>
      </Show>
    </aside>
  );
}
import { ParentSection } from "./inspector/ParentSection.tsx";
