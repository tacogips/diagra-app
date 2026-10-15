import type { Editor } from "@nodetto/core";
import type { Element } from "@nodetto/ir";
import { Field, Section, SelectInput, Swatches } from "./controls.tsx";
import { STYLE_PALETTE } from "./palette.ts";

/** Small diagram vocabulary; full style editing lives in advanced properties. */
export function BasicAppearance(props: {
  readonly editor: Editor;
  readonly leaves: readonly Element[];
}) {
  const style = () => props.leaves[0]?.visual.style;
  return (
    <Section title="Appearance">
      <Field label="Fill">
        <Swatches
          label="Diagram fill"
          entries={STYLE_PALETTE.fills}
          value={style()?.fill}
          onPick={(fill) =>
            props.editor.setSelectionStyle({ fill, fillGradient: null })
          }
        />
      </Field>
      <Field label="Stroke">
        <Swatches
          label="Diagram stroke"
          entries={STYLE_PALETTE.strokes}
          value={style()?.stroke}
          onPick={(stroke) =>
            props.editor.setSelectionStyle({ stroke, strokeGradient: null })
          }
        />
      </Field>
      <Field label="Text">
        <Swatches
          label="Diagram text colour"
          entries={STYLE_PALETTE.strokes}
          value={style()?.color}
          onPick={(color) => props.editor.setSelectionStyle({ color })}
        />
      </Field>
      <Field label="Size">
        <SelectInput
          label="Diagram font size"
          value={style()?.fontSize?.toString() ?? ""}
          options={[
            { value: "", label: "Default" },
            ...[12, 14, 16, 20, 24, 32].map((size) => ({
              value: String(size),
              label: String(size),
            })),
          ]}
          onCommit={(value) =>
            props.editor.setSelectionStyle({
              fontSize: value ? Number(value) : null,
            })
          }
        />
      </Field>
    </Section>
  );
}
