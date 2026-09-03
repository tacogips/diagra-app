// Geometry section: position and size of a single box element.
//
// X and Y are the element's own `visual` origin. Width and height go through
// the ShapeUtil's resize so a type with a derived dimension (an ERD table's
// height follows its columns) refuses the edit the same way its handles do.
// Rotation is shown but not yet editable (design editor-ux.md, Wave 2).

import type { Editor } from "@diagra/core";
import type { Element } from "@diagra/ir";
import type { JSX } from "solid-js";
import { Field, NumberInput, Section } from "./controls.tsx";
import { writeVisual } from "./write.ts";

export interface GeometrySectionProps {
  readonly editor: Editor;
  readonly element: Element;
}

export function GeometrySection(props: GeometrySectionProps): JSX.Element {
  const box = () => props.editor.getBounds(props.element.id);
  const resizable = (): boolean =>
    props.editor.getShapeUtil(props.element.type).canResize;

  const resize = (patch: { width?: number; height?: number }): void => {
    const current = box();
    const util = props.editor.getShapeUtil(props.element.type);
    if (!current || !util.canResize || !util.resize) {
      return;
    }
    const next = util.resize(props.element, { ...current, ...patch });
    writeVisual(props.editor, props.element.id, next.visual);
  };

  return (
    <Section title="Geometry">
      <div class="diagra-field-grid">
        <Field label="X">
          <NumberInput
            label="X"
            value={props.element.visual.x ?? box()?.x ?? null}
            onCommit={(x) => writeVisual(props.editor, props.element.id, { x })}
          />
        </Field>
        <Field label="Y">
          <NumberInput
            label="Y"
            value={props.element.visual.y ?? box()?.y ?? null}
            onCommit={(y) => writeVisual(props.editor, props.element.id, { y })}
          />
        </Field>
        <Field label="Width">
          <NumberInput
            label="Width"
            value={box()?.width ?? null}
            min={1}
            disabled={!resizable()}
            onCommit={(width) => resize({ width })}
          />
        </Field>
        <Field label="Height">
          <NumberInput
            label="Height"
            value={box()?.height ?? null}
            min={1}
            disabled={!resizable()}
            onCommit={(height) => resize({ height })}
          />
        </Field>
        <Field label="Rotation">
          <NumberInput
            label="Rotation (read-only)"
            value={props.element.visual.rotation ?? 0}
            disabled
            onCommit={() => undefined}
          />
        </Field>
      </div>
    </Section>
  );
}
