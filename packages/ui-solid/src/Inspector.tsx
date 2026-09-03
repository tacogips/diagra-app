// The Inspector: a right-hand panel that reads the selection and writes
// commands (design editor-ux.md section 4).
//
// It holds no document state. Every section reads the element straight off
// the store through the editor signals and writes through `editor.apply`,
// so a remote edit re-renders the fields exactly like a local one. Keyboard
// events are stopped at the panel's root with native listeners: a letter
// typed into a field must never reach a canvas or window shortcut.

import type { Editor } from "@diagra/core";
import { leafElements } from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import { createMemo, type JSX, Match, Show, Switch } from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  ErdRelationSection,
  ErdTableSection,
} from "./inspector/ErdSections.tsx";
import { GeometrySection } from "./inspector/GeometrySection.tsx";
import {
  AssociationSection,
  EdgeSection,
  GeoSection,
  GroupSection,
  NodeSection,
  PageSection,
  TextNoteSection,
} from "./inspector/SimpleSections.tsx";
import { StyleSection } from "./inspector/StyleSection.tsx";
import { UmlClassSection } from "./inspector/UmlClassSection.tsx";

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
      <Show when={selectedIds().length === 0}>
        <Show when={page()}>
          {(current) => <PageSection editor={props.editor} page={current()} />}
        </Show>
      </Show>

      <Show when={selectedIds().length > 1}>
        <p class="diagra-inspector-summary">
          {`${selectedIds().length} elements selected`}
        </p>
      </Show>

      <Show when={single()}>
        {(element) => (
          <Switch>
            <Match when={element().type === "shape.geo"}>
              <GeoSection editor={props.editor} element={element()} />
            </Match>
            <Match when={element().type === "node.generic"}>
              <NodeSection editor={props.editor} element={element()} />
            </Match>
            <Match when={element().type === "text.note"}>
              <TextNoteSection editor={props.editor} element={element()} />
            </Match>
            <Match when={element().type === "edge.generic"}>
              <EdgeSection editor={props.editor} element={element()} />
            </Match>
            <Match when={element().type === "erd.table"}>
              <ErdTableSection
                editor={props.editor}
                element={element()}
                focusRow={focusRow()}
              />
            </Match>
            <Match when={element().type === "erd.relation"}>
              <ErdRelationSection editor={props.editor} element={element()} />
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
    </aside>
  );
}
