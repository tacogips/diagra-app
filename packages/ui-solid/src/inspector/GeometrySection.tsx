// Geometry section: position and size of a single box element.
//
// X and Y are the element's own `visual` origin. Width and height go through
// the ShapeUtil's resize so a type with a derived dimension (an ERD table's
// height follows its columns) refuses the edit the same way its handles do.
// Rotation uses the element/container center and commits through the shared core
// hierarchy operation.

import {
  type Editor,
  canRotateElement,
  rotateElement,
  supportsAspectRatio,
} from "@diagra/core";
import { type Element, getElementTypeDefinition } from "@diagra/ir";
import { type JSX, Show } from "solid-js";
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
    if (!current || !resizable()) return;
    props.editor.resizeElement(props.element.id, { ...current, ...patch });
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
            label="Rotation (degrees)"
            value={props.element.visual.rotation ?? 0}
            disabled={!canRotateElement(props.element)}
            onCommit={(degrees) =>
              rotateElement(props.editor, props.element.id, degrees)
            }
          />
        </Field>
      </div>
      <p class="diagra-muted">
        Rotation uses the layer center. Database/class rows own height, so their
        canvas handles resize width only.
      </p>
      <Show when={resizable() && supportsAspectRatio(props.element)}>
        <label>
          <input
            type="checkbox"
            checked={props.element.visual.aspectRatio !== undefined}
            onChange={(event) => {
              const current = box();
              if (!current || current.width <= 0 || current.height <= 0) return;
              const { aspectRatio: _old, ...rest } = props.element.visual;
              props.editor.apply([
                {
                  type: "replaceVisual",
                  id: props.element.id,
                  visual: {
                    ...rest,
                    ...(event.currentTarget.checked
                      ? { aspectRatio: current.width / current.height }
                      : {}),
                  },
                },
              ]);
            }}
          />
          Lock aspect ratio
        </label>
      </Show>
      <Show
        when={getElementTypeDefinition(props.element.type)?.category !== "edge"}
      >
        <label>
          <input
            type="checkbox"
            checked={props.element.visual.prototypeFixed === true}
            onChange={(event) => {
              const { prototypeFixed: _old, ...rest } = props.element.visual;
              props.editor.apply([
                {
                  type: "replaceVisual",
                  id: props.element.id,
                  visual: {
                    ...rest,
                    ...(event.currentTarget.checked
                      ? { prototypeFixed: true }
                      : {}),
                  },
                },
              ]);
            }}
          />
          Fix position when prototype scrolls
        </label>
      </Show>
    </Section>
  );
}
