// Style section: the `VisualStyle` fields, for any selection.
//
// A mixed selection shows the first leaf's values and writes to every leaf
// through `setSelectionStyle`, which is one command batch and one undo step.
// "Default" clears a field (a `null` in the patch) so the stylesheet rules
// apply again, which is the only way back to "no explicit style".

import type { Editor, StylePatch } from "@diagra/core";
import type { Element, VisualStyle } from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import { Field, Section, SelectInput, Swatches } from "./controls.tsx";
import { STYLE_PALETTE } from "./palette.ts";

export interface StyleSectionProps {
  readonly editor: Editor;
  /** The non-group elements the selection reaches; never empty. */
  readonly leaves: readonly Element[];
}

/** Types whose body has a fill of its own (connectors and groups do not). */
const FILLED_TYPES: ReadonlySet<string> = new Set([
  "shape.geo",
  "node.generic",
  "text.note",
  "erd.table",
  "uml.class",
]);

const DEFAULT_OPTION = { value: "", label: "Default" };

const STROKE_WIDTHS = ["1", "1.5", "2", "3", "4"];
const FONT_SIZES = [
  "10",
  "11",
  "12",
  "13",
  "14",
  "16",
  "18",
  "20",
  "24",
  "28",
  "32",
];
const DASHES: readonly { value: string; label: string }[] = [
  DEFAULT_OPTION,
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const ALIGNMENTS: readonly {
  value: NonNullable<VisualStyle["textAlign"]>;
  label: string;
}[] = [
  { value: "start", label: "Left" },
  { value: "middle", label: "Centre" },
  { value: "end", label: "Right" },
];

function numberOption(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export function StyleSection(props: StyleSectionProps): JSX.Element {
  const style = (): VisualStyle => props.leaves[0]?.visual.style ?? {};
  const fillable = (): boolean =>
    props.leaves.some((leaf) => FILLED_TYPES.has(leaf.type));
  const write = (patch: StylePatch): void => {
    props.editor.setSelectionStyle(patch);
  };
  const opacityPercent = (): number => Math.round((style().opacity ?? 1) * 100);

  return (
    <Section title="Style">
      <Show when={fillable()}>
        <Field label="Fill">
          <Swatches
            label="Fill"
            entries={STYLE_PALETTE.fills}
            value={style().fill}
            onPick={(fill) => write({ fill })}
          />
        </Field>
      </Show>
      <Field label="Stroke">
        <Swatches
          label="Stroke"
          entries={STYLE_PALETTE.strokes}
          value={style().stroke}
          onPick={(stroke) => write({ stroke })}
        />
      </Field>
      <Field label="Width">
        <SelectInput
          label="Stroke width"
          value={numberOption(style().strokeWidth)}
          options={[
            DEFAULT_OPTION,
            ...STROKE_WIDTHS.map((width) => ({ value: width, label: width })),
          ]}
          onCommit={(value) =>
            write({ strokeWidth: value === "" ? null : Number(value) })
          }
        />
      </Field>
      <Field label="Dash">
        <SelectInput
          label="Dash"
          value={style().dash ?? ""}
          options={DASHES}
          onCommit={(value) =>
            write({
              dash: value === "" ? null : (value as VisualStyle["dash"]),
            })
          }
        />
      </Field>
      <Field label="Opacity">
        <div class="diagra-opacity">
          <input
            type="range"
            class="diagra-range"
            aria-label="Opacity"
            min={0}
            max={100}
            step={5}
            value={opacityPercent()}
            on:change={(event) => {
              const percent = Number(event.currentTarget.value);
              write({ opacity: percent >= 100 ? null : percent / 100 });
            }}
          />
          <span class="diagra-opacity-value">{`${opacityPercent()}%`}</span>
        </div>
      </Field>
      <Field label="Text">
        <Swatches
          label="Text colour"
          entries={STYLE_PALETTE.strokes}
          value={style().color}
          onPick={(color) => write({ color })}
        />
      </Field>
      <Field label="Size">
        <SelectInput
          label="Font size"
          value={numberOption(style().fontSize)}
          options={[
            DEFAULT_OPTION,
            ...FONT_SIZES.map((size) => ({ value: size, label: size })),
          ]}
          onCommit={(value) =>
            write({ fontSize: value === "" ? null : Number(value) })
          }
        />
      </Field>
      <Field label="Align">
        <div class="diagra-segmented" role="group" aria-label="Text align">
          <For each={ALIGNMENTS}>
            {(alignment) => (
              <button
                type="button"
                class="diagra-segment"
                title={`${alignment.label} (click again for default)`}
                aria-pressed={style().textAlign === alignment.value}
                onClick={() =>
                  write({
                    textAlign:
                      style().textAlign === alignment.value
                        ? null
                        : alignment.value,
                  })
                }
              >
                {alignment.label}
              </button>
            )}
          </For>
        </div>
      </Field>
    </Section>
  );
}
