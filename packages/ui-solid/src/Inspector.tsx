// The Inspector: a right-hand panel that reads the selection and writes
// commands (design editor-ux.md section 4).
//
// It holds no document state. Every section reads the element straight off
// the store through the editor signals and writes through `editor.apply`,
// so a remote edit re-renders the fields exactly like a local one. Keyboard
// events are stopped at the panel's root with native listeners: a letter
// typed into a field must never reach a canvas or window shortcut.

import type { Editor } from "@diagra/core";
import { leafElements, layerName, renameLayer } from "@diagra/core";
import { BatchRenameSection } from "./inspector/BatchRenameSection.tsx";
import { ReplaceNoteTextSection } from "./inspector/ReplaceNoteTextSection.tsx";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
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
import { StyleSection } from "./inspector/StyleSection.tsx";
import { ImageSection } from "./inspector/ImageSection.tsx";
import { UmlClassSection } from "./inspector/UmlClassSection.tsx";
import { ColorBindingsSection } from "./inspector/ColorBindingsSection.tsx";
import { NumberBindingsSection } from "./inspector/NumberBindingsSection.tsx";
import { TextStyleBindingsSection } from "./inspector/TextStyleBindingsSection.tsx";
import { StrokeSection } from "./inspector/StrokeSection.tsx";
import { PathSection } from "./inspector/PathSection.tsx";
import { Field, Section, TextInput } from "./inspector/controls.tsx";

const DatabaseExportSection = lazy(
  () => import("./inspector/DatabaseExportSection.tsx"),
);
const MermaidExportSection = lazy(
  () => import("./inspector/MermaidExportSection.tsx"),
);
const D2ExportSection = lazy(() => import("./inspector/D2ExportSection.tsx"));
const AssetExportSection = lazy(() =>
  import("./inspector/AssetExportSection.tsx").then((module) => ({
    default: module.AssetExportSection,
  })),
);
const HandoffSection = lazy(() =>
  import("./inspector/HandoffSection.tsx").then((module) => ({
    default: module.HandoffSection,
  })),
);
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
  const databasePage = createMemo(() => {
    signals.rev();
    const current = page();
    return current &&
      props.editor.store
        .getPageElements(current.id)
        .some((element) => element.type === "erd.table")
      ? current.id
      : null;
  });

  const focusRow = (): number | undefined => {
    const element = single();
    return element && props.focus?.id === element.id
      ? props.focus.row
      : undefined;
  };

  return (
    <aside
      class="diagra-inspector"
      aria-label="Inspector"
      on:keydown={stop}
      on:keyup={stop}
    >
      <Show
        when={(() => {
          signals.rev();
          return props.editor.readOnly;
        })()}
      >
        <p role="status">
          View only. Properties can be inspected; handoff and export remain
          available.
        </p>
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
                <p>
                  Editor-only name. Clear to use the content label; visible text
                  and database names stay unchanged.
                </p>
              </Section>
              <ParentSection editor={props.editor} element={element()} />
              <Suspense>
                <AccessibilitySection
                  editor={props.editor}
                  element={element()}
                />
              </Suspense>
            </>
          )}
        </Show>
        <Show when={selectedIds().length === 0}>
          <Show when={page()}>
            {(current) => (
              <PageSection editor={props.editor} page={current()} />
            )}
          </Show>
        </Show>

        <Show when={selectedIds().length > 1}>
          <p class="diagra-inspector-summary">
            {`${selectedIds().length} elements selected`}
          </p>
          <SelectionGeometrySection editor={props.editor} />
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
              <Match when={element().type === "group"}>
                <GroupSection editor={props.editor} element={element()} />
              </Match>
            </Switch>
          )}
        </Show>

        <Show when={leaves().length > 0}>
          <StyleSection editor={props.editor} leaves={leaves()} />
        </Show>

        <Show when={single()}>
          {(element) => (
            <Show when={hasOwnGeometry(element())}>
              <GeometrySection editor={props.editor} element={element()} />
            </Show>
          )}
        </Show>
      </fieldset>
      <fieldset
        style={{ border: "none", margin: 0, padding: 0, "min-width": 0 }}
        disabled={(() => {
          signals.rev();
          return props.editor.readOnly;
        })()}
      >
        <Show when={selectedIds().length > 1}>
          <BatchRenameSection editor={props.editor} />
        </Show>
        <ColorBindingsSection editor={props.editor} />
        <Show
          when={selectedIds().some(
            (id) => props.editor.store.get(id)?.type === "text.note",
          )}
        >
          <ReplaceNoteTextSection editor={props.editor} />
        </Show>
        <NumberBindingsSection editor={props.editor} />
        <TextStyleBindingsSection editor={props.editor} />
      </fieldset>
      <Show when={databasePage()} keyed>
        {(pageId) => (
          <Suspense>
            <DatabaseExportSection editor={props.editor} pageId={pageId} />
          </Suspense>
        )}
      </Show>
      <Show when={page()} keyed>
        {(current) => (
          <>
            <Suspense>
              <MermaidExportSection editor={props.editor} pageId={current.id} />
            </Suspense>
            <Suspense>
              <D2ExportSection editor={props.editor} pageId={current.id} />
            </Suspense>
          </>
        )}
      </Show>
      <Show when={page()}>
        <Suspense>
          <AssetExportSection
            editor={props.editor}
            id={single()?.type === "frame" ? single()?.id : undefined}
            hasSelection={selectedIds().length > 0}
          />
        </Suspense>
      </Show>
      <Show when={single()}>
        {(element) => (
          <Suspense>
            <fieldset
              style={{ border: "none", margin: 0, padding: 0, "min-width": 0 }}
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
      <Show when={single()}>
        {(element) => (
          <Suspense>
            <HandoffSection editor={props.editor} id={element().id} />
          </Suspense>
        )}
      </Show>
    </aside>
  );
}
import { ParentSection } from "./inspector/ParentSection.tsx";
