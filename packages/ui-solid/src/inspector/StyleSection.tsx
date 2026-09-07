// Style section: the `VisualStyle` fields, for any selection.
//
// A mixed selection shows the first leaf's values and writes to every leaf
// through `setSelectionStyle`, which is one command batch and one undo step.
// "Default" clears a field (a `null` in the patch) so the stylesheet rules
// apply again, which is the only way back to "no explicit style".

import type { Editor, StylePatch } from "@diagra/core";
import type {
  BlendMode,
  CornerRadii,
  Element,
  FontFeatureSetting,
  FontVariationAxis,
  LayerEffect,
  VisualStyle,
} from "@diagra/ir";
import { BLEND_MODES } from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import {
  Field,
  NumberInput,
  Section,
  SelectInput,
  Swatches,
  TextInput,
} from "./controls.tsx";
import { STYLE_PALETTE } from "./palette.ts";
import { PaintGradientEditor } from "./PaintGradientEditor.tsx";

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
  "frame",
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
const STROKE_CAPS: readonly { value: string; label: string }[] = [
  DEFAULT_OPTION,
  { value: "butt", label: "Butt" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
];
const STROKE_JOINS: readonly { value: string; label: string }[] = [
  DEFAULT_OPTION,
  { value: "miter", label: "Miter" },
  { value: "round", label: "Round" },
  { value: "bevel", label: "Bevel" },
];
const BLEND_MODE_OPTIONS = BLEND_MODES.map((value) => ({
  value,
  label: value
    .split("-")
    .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
    .join(" "),
}));
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
  const addFontSetting = (kind: "variation" | "feature"): void => {
    const key = kind === "variation" ? "fontVariations" : "fontFeatures";
    const current = style()[key] ?? [];
    const choices =
      kind === "variation"
        ? ["wght", "wdth", "opsz", "slnt", "ital", "GRAD"]
        : ["liga", "kern", "calt", "ss01", "tnum", "frac"];
    const tag = choices.find(
      (candidate) => !current.some((setting) => setting.tag === candidate),
    );
    if (!tag || current.length >= 16) return;
    write({
      [key]: [
        ...current,
        { tag, value: kind === "variation" && tag === "wght" ? 400 : 1 },
      ],
    });
  };
  const updateFontSetting = (
    kind: "variation" | "feature",
    index: number,
    next: FontVariationAxis | FontFeatureSetting | null,
  ): void => {
    const key = kind === "variation" ? "fontVariations" : "fontFeatures";
    const current = [...(style()[key] ?? [])];
    if (next) current[index] = next;
    else current.splice(index, 1);
    write({ [key]: current.length ? current : null });
  };
  const cornerRadii = (): CornerRadii =>
    style().cornerRadii ?? {
      topLeft: style().cornerRadius ?? 0,
      topRight: style().cornerRadius ?? 0,
      bottomRight: style().cornerRadius ?? 0,
      bottomLeft: style().cornerRadius ?? 0,
    };
  const effects = (): readonly LayerEffect[] => {
    const current = style();
    if (current.effects) return current.effects;
    return current.shadow ? [{ type: "drop-shadow", ...current.shadow }] : [];
  };
  const updateEffects = (next: readonly LayerEffect[]): void =>
    write({ effects: next, shadow: null });
  const updateEffect = (index: number, next: LayerEffect): void =>
    updateEffects(
      effects().map((effect, at) => (at === index ? next : effect)),
    );
  return (
    <Section title="Style">
      <div class="diagra-effect-actions">
        <button
          type="button"
          disabled={effects().length >= 8}
          onClick={() =>
            updateEffects([
              ...effects(),
              {
                type: "drop-shadow",
                x: 0,
                y: 4,
                blur: 4,
                color: "#000000",
                opacity: 0.2,
              },
            ])
          }
        >
          Add shadow
        </button>
        <button
          type="button"
          disabled={effects().length >= 8}
          onClick={() =>
            updateEffects([...effects(), { type: "layer-blur", blur: 4 }])
          }
        >
          Add layer blur
        </button>
        <button
          type="button"
          disabled={effects().length >= 8}
          onClick={() =>
            updateEffects([...effects(), { type: "background-blur", blur: 8 }])
          }
        >
          Add background blur
        </button>
      </div>
      <For each={effects()}>
        {(effect, index) => (
          <div class="diagra-effect-entry">
            <label>
              <input
                type="checkbox"
                checked={effect.enabled !== false}
                onChange={(event) =>
                  updateEffect(index(), {
                    ...effect,
                    enabled: event.currentTarget.checked,
                  })
                }
              />
              Effect {index() + 1}
            </label>
            <SelectInput
              label={`Effect ${index() + 1} type`}
              value={effect.type}
              options={[
                { value: "drop-shadow", label: "Drop shadow" },
                { value: "layer-blur", label: "Layer blur" },
                { value: "background-blur", label: "Background blur" },
              ]}
              onCommit={(type) =>
                updateEffect(
                  index(),
                  type === "drop-shadow"
                    ? {
                        type,
                        x: 0,
                        y: 4,
                        blur: effect.blur,
                        color: "#000000",
                        opacity: 0.2,
                        enabled: effect.enabled,
                      }
                    : {
                        type:
                          type === "background-blur"
                            ? "background-blur"
                            : "layer-blur",
                        blur: effect.blur,
                        enabled: effect.enabled,
                      },
                )
              }
            />
            <Show when={effect.type === "drop-shadow"}>
              <For each={["x", "y"] as const}>
                {(field) => (
                  <NumberInput
                    label={`Effect ${index() + 1} shadow ${field.toUpperCase()} offset`}
                    value={effect.type === "drop-shadow" ? effect[field] : 0}
                    onCommit={(value) => {
                      if (effect.type === "drop-shadow")
                        updateEffect(index(), { ...effect, [field]: value });
                    }}
                  />
                )}
              </For>
              <input
                type="color"
                aria-label={`Effect ${index() + 1} shadow color`}
                value={effect.type === "drop-shadow" ? effect.color : "#000000"}
                onChange={(event) => {
                  if (effect.type === "drop-shadow")
                    updateEffect(index(), {
                      ...effect,
                      color: event.currentTarget.value,
                    });
                }}
              />
              <NumberInput
                label={`Effect ${index() + 1} shadow opacity percent`}
                min={0}
                value={
                  effect.type === "drop-shadow"
                    ? Math.round(effect.opacity * 100)
                    : 100
                }
                onCommit={(opacity) => {
                  if (effect.type === "drop-shadow")
                    updateEffect(index(), {
                      ...effect,
                      opacity: Math.min(100, opacity) / 100,
                    });
                }}
              />
            </Show>
            <NumberInput
              label={`Effect ${index() + 1} blur`}
              min={0}
              value={effect.blur}
              onCommit={(blur) => updateEffect(index(), { ...effect, blur })}
            />
            <div>
              <button
                type="button"
                disabled={index() === 0}
                onClick={() => {
                  const next = [...effects()];
                  const at = index();
                  [next[at - 1], next[at]] = [
                    next[at] as LayerEffect,
                    next[at - 1] as LayerEffect,
                  ];
                  updateEffects(next);
                }}
              >
                Earlier
              </button>
              <button
                type="button"
                disabled={index() === effects().length - 1}
                onClick={() => {
                  const next = [...effects()];
                  const at = index();
                  [next[at], next[at + 1]] = [
                    next[at + 1] as LayerEffect,
                    next[at] as LayerEffect,
                  ];
                  updateEffects(next);
                }}
              >
                Later
              </button>
              <button
                type="button"
                onClick={() =>
                  updateEffects(effects().filter((_, at) => at !== index()))
                }
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={fillable()}>
        <Field label="Fill">
          <Swatches
            label="Fill"
            entries={STYLE_PALETTE.fills}
            value={style().fill}
            onPick={(fill) => write({ fill })}
          />
        </Field>
        <PaintGradientEditor
          label="Fill"
          gradient={style().fillGradient}
          fallback={style().fill ?? "#2563eb"}
          onCommit={(fillGradient) => write({ fillGradient })}
        />
      </Show>
      <Field label="Stroke">
        <Swatches
          label="Stroke"
          entries={STYLE_PALETTE.strokes}
          value={style().stroke}
          onPick={(stroke) => write({ stroke })}
        />
      </Field>
      <PaintGradientEditor
        label="Stroke"
        gradient={style().strokeGradient}
        fallback={style().stroke ?? "#1d2a2e"}
        onCommit={(strokeGradient) => write({ strokeGradient })}
      />
      <Field label="Custom fill">
        <input
          type="color"
          aria-label="Custom fill color"
          value={
            /^#[\da-f]{6}$/i.test(style().fill ?? "") ? style().fill : "#ffffff"
          }
          onChange={(event) => write({ fill: event.currentTarget.value })}
        />
      </Field>
      <Field label="Custom stroke">
        <input
          type="color"
          aria-label="Custom stroke color"
          value={
            /^#[\da-f]{6}$/i.test(style().stroke ?? "")
              ? style().stroke
              : "#000000"
          }
          onChange={(event) => write({ stroke: event.currentTarget.value })}
        />
      </Field>
      <Field label="Custom text">
        <input
          type="color"
          aria-label="Custom text color"
          value={
            /^#[\da-f]{6}$/i.test(style().color ?? "")
              ? style().color
              : "#000000"
          }
          onChange={(event) => write({ color: event.currentTarget.value })}
        />
      </Field>
      <Show
        when={props.leaves.some(
          (leaf) =>
            leaf.type === "frame" ||
            leaf.type === "node.generic" ||
            (leaf.type === "shape.geo" &&
              (leaf.semantic as { geo?: string }).geo === "rect"),
        )}
      >
        <Field label="Corners">
          <div>
            <Show
              when={style().cornerRadii}
              fallback={
                <NumberInput
                  label="Corner radius"
                  min={0}
                  value={style().cornerRadius ?? 0}
                  onCommit={(cornerRadius) =>
                    write({ cornerRadius, cornerRadii: null })
                  }
                />
              }
            >
              <For
                each={
                  [
                    ["topLeft", "Top left"],
                    ["topRight", "Top right"],
                    ["bottomRight", "Bottom right"],
                    ["bottomLeft", "Bottom left"],
                  ] as const
                }
              >
                {([field, label]) => (
                  <NumberInput
                    label={`${label} radius`}
                    min={0}
                    value={cornerRadii()[field]}
                    onCommit={(value) =>
                      write({
                        cornerRadius: null,
                        cornerRadii: { ...cornerRadii(), [field]: value },
                      })
                    }
                  />
                )}
              </For>
            </Show>
            <button
              type="button"
              class="diagra-inspector-button"
              onClick={() => {
                const radii = cornerRadii();
                write(
                  style().cornerRadii
                    ? { cornerRadii: null, cornerRadius: radii.topLeft }
                    : { cornerRadius: null, cornerRadii: radii },
                );
              }}
            >
              {style().cornerRadii
                ? "Use uniform corners"
                : "Edit corners independently"}
            </button>
          </div>
        </Field>
      </Show>
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
      <Field label="Cap">
        <SelectInput
          label="Stroke cap"
          value={style().strokeCap ?? ""}
          options={STROKE_CAPS}
          onCommit={(value) =>
            write({
              strokeCap:
                value === "" ? null : (value as VisualStyle["strokeCap"]),
            })
          }
        />
      </Field>
      <Field label="Join">
        <div class="diagra-inline-fields">
          <SelectInput
            label="Stroke join"
            value={style().strokeJoin ?? ""}
            options={STROKE_JOINS}
            onCommit={(value) => {
              const strokeJoin =
                value === "" ? null : (value as VisualStyle["strokeJoin"]);
              write({
                strokeJoin,
                ...(value === "miter" ? {} : { strokeMiterLimit: null }),
              });
            }}
          />
          <Show when={style().strokeJoin === "miter"}>
            <NumberInput
              label="Miter limit"
              min={1}
              value={style().strokeMiterLimit ?? 4}
              onCommit={(strokeMiterLimit) => write({ strokeMiterLimit })}
            />
          </Show>
        </div>
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
      <Field label="Blend">
        <SelectInput
          label="Blend mode"
          value={style().blendMode ?? "normal"}
          options={BLEND_MODE_OPTIONS}
          onCommit={(blendMode) =>
            write({
              blendMode:
                blendMode === "normal" ? null : (blendMode as BlendMode),
            })
          }
        />
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
      <Field label="Family">
        <TextInput
          label="Font family"
          value={style().fontFamily ?? ""}
          placeholder="system-ui, sans-serif"
          onCommit={(fontFamily) =>
            write({ fontFamily: fontFamily.trim() || null })
          }
        />
      </Field>
      <Field label="Custom size">
        <NumberInput
          label="Custom font size"
          min={1}
          value={style().fontSize ?? 13}
          onCommit={(fontSize) => write({ fontSize })}
        />
      </Field>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() =>
          write({
            fontFamily: null,
            fontWeight: null,
            fontStyle: null,
            fontVariations: null,
            fontFeatures: null,
            textDecoration: null,
            lineHeight: null,
            letterSpacing: null,
            verticalAlign: null,
          })
        }
      >
        Reset typography
      </button>
      <Field label="Weight">
        <SelectInput
          label="Font weight"
          value={numberOption(style().fontWeight)}
          options={[
            DEFAULT_OPTION,
            ...[300, 400, 500, 600, 700, 800, 900].map((weight) => ({
              value: String(weight),
              label: String(weight),
            })),
          ]}
          onCommit={(value) =>
            write({ fontWeight: value ? Number(value) : null })
          }
        />
      </Field>
      <Field label="Slant">
        <SelectInput
          label="Font style"
          value={style().fontStyle ?? ""}
          options={[
            DEFAULT_OPTION,
            { value: "normal", label: "Normal" },
            { value: "italic", label: "Italic" },
          ]}
          onCommit={(value) =>
            write({ fontStyle: value ? (value as "normal" | "italic") : null })
          }
        />
      </Field>
      <Field label="Decoration">
        <SelectInput
          label="Text decoration"
          value={style().textDecoration ?? ""}
          options={[
            DEFAULT_OPTION,
            { value: "none", label: "None" },
            { value: "underline", label: "Underline" },
            { value: "line-through", label: "Strikethrough" },
            { value: "underline line-through", label: "Underline + strike" },
          ]}
          onCommit={(value) =>
            write({
              textDecoration: value
                ? (value as NonNullable<VisualStyle["textDecoration"]>)
                : null,
            })
          }
        />
      </Field>
      <Field label="Line height">
        <NumberInput
          label="Line height multiplier"
          min={0.1}
          step={0.1}
          value={style().lineHeight ?? 1.35}
          onCommit={(lineHeight) => write({ lineHeight })}
        />
      </Field>
      <Field label="Tracking">
        <NumberInput
          label="Letter spacing"
          step={0.1}
          value={style().letterSpacing ?? 0}
          onCommit={(letterSpacing) => write({ letterSpacing })}
        />
      </Field>
      <Field label="Variable axes">
        <div class="diagra-effect-entry">
          <For each={style().fontVariations ?? []}>
            {(setting, index) => (
              <div class="diagra-effect-actions">
                <TextInput
                  label={`Variation axis ${index() + 1} tag`}
                  value={setting.tag}
                  onCommit={(tag) => {
                    const normalized = tag.trim();
                    const duplicate = style().fontVariations?.some(
                      (candidate, at) =>
                        at !== index() && candidate.tag === normalized,
                    );
                    if (/^[A-Za-z0-9]{4}$/.test(normalized) && !duplicate)
                      updateFontSetting("variation", index(), {
                        ...setting,
                        tag: normalized,
                      });
                  }}
                />
                <NumberInput
                  label={`Variation axis ${setting.tag} value`}
                  value={setting.value}
                  onCommit={(value) =>
                    updateFontSetting("variation", index(), {
                      ...setting,
                      value,
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() => updateFontSetting("variation", index(), null)}
                >
                  Remove
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            disabled={(style().fontVariations?.length ?? 0) >= 16}
            onClick={() => addFontSetting("variation")}
          >
            Add axis
          </button>
        </div>
      </Field>
      <Field label="OpenType features">
        <div class="diagra-effect-entry">
          <For each={style().fontFeatures ?? []}>
            {(setting, index) => (
              <div class="diagra-effect-actions">
                <TextInput
                  label={`OpenType feature ${index() + 1} tag`}
                  value={setting.tag}
                  onCommit={(tag) => {
                    const normalized = tag.trim();
                    const duplicate = style().fontFeatures?.some(
                      (candidate, at) =>
                        at !== index() && candidate.tag === normalized,
                    );
                    if (/^[A-Za-z0-9]{4}$/.test(normalized) && !duplicate)
                      updateFontSetting("feature", index(), {
                        ...setting,
                        tag: normalized,
                      });
                  }}
                />
                <NumberInput
                  label={`OpenType feature ${setting.tag} value`}
                  min={0}
                  step={1}
                  value={setting.value}
                  onCommit={(value) =>
                    updateFontSetting("feature", index(), {
                      ...setting,
                      value: Math.max(0, Math.round(value)),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() => updateFontSetting("feature", index(), null)}
                >
                  Remove
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            disabled={(style().fontFeatures?.length ?? 0) >= 16}
            onClick={() => addFontSetting("feature")}
          >
            Add feature
          </button>
        </div>
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
      <Show
        when={props.leaves.every((element) => element.type === "text.note")}
      >
        <Field label="Text sizing">
          <select
            aria-label="Text sizing"
            value={props.leaves[0]?.visual.textResize ?? "fixed"}
            onChange={(event) =>
              props.editor.setSelectionTextResize(
                event.currentTarget.value as
                  | "fixed"
                  | "auto-width"
                  | "auto-height",
              )
            }
          >
            <option value="fixed">Fixed box</option>
            <option value="auto-width">Auto width</option>
            <option value="auto-height">Auto height</option>
          </select>
        </Field>
        <Field label="Vertical align">
          <select
            aria-label="Vertical text alignment"
            value={style().verticalAlign ?? "top"}
            onChange={(event) =>
              write({
                verticalAlign: event.currentTarget.value as
                  | "top"
                  | "middle"
                  | "bottom",
              })
            }
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </Field>
      </Show>
    </Section>
  );
}
