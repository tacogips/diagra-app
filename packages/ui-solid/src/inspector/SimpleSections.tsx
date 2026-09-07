// The small semantic sections: one or two fields per type, plus the group
// and page sections. Each control commits one whole-payload `updateSemantic`.

import type { Editor } from "@diagra/core";
import {
  addLayoutGrid,
  artboardOrientationIssue,
  swapArtboardOrientation,
  addComponentVariantProperty,
  componentVariantAxes,
  componentVariants,
  compareFractional,
  frameParents,
  FRAME_PRESETS,
  type FramePresetKey,
  groupMaskCandidates,
  layerName,
  MAX_LAYOUT_GRIDS,
  MAX_VARIANT_PROPERTIES,
  memberIdsOf,
  removeLayoutGrid,
  removeTextMarkRange,
  removeComponentVariantProperty,
  switchComponentVariantProperty,
  setGroupMask,
  setGroupBooleanOperation,
  textNoteMarks,
  textRangeHasMark,
  updateLayoutGrid,
  updateComponentVariantProperty,
} from "@diagra/core";
import {
  BOOLEAN_OPERATIONS,
  type BooleanOperation,
  ARROWHEADS,
  BLEND_MODES,
  type BlendMode,
  type Element,
  type FrameLayout,
  FRAME_PLATFORMS,
  type FramePlatform,
  type FrameSemantic,
  type GroupSemantic,
  GEO_KINDS,
  type LayoutGrid,
  MESSAGE_KINDS,
  PAGE_KINDS,
  type Page,
  type PageKind,
  PARTICIPANT_KINDS,
  type TextMarkKind,
  UML_ASSOCIATION_KINDS,
} from "@diagra/ir";
import { createSignal, For, type JSX, lazy, Show, Suspense } from "solid-js";
import {
  Field,
  NumberInput,
  Section,
  SelectInput,
  type SelectOption,
  TextArea,
  TextInput,
} from "./controls.tsx";
import { withOptionalString } from "./edits.ts";
import { writeSemantic } from "./write.ts";

const PageGuidesSection = lazy(() => import("./PageGuidesSection.tsx"));
const ConnectorRoutingFields = lazy(
  () => import("./ConnectorRoutingFields.tsx"),
);

export interface ElementSectionProps {
  readonly editor: Editor;
  readonly element: Element;
}

function record(semantic: unknown): Record<string, unknown> {
  return typeof semantic === "object" && semantic !== null
    ? (semantic as Record<string, unknown>)
    : {};
}

function stringOf(semantic: unknown, field: string): string {
  const value = record(semantic)[field];
  return typeof value === "string" ? value : "";
}

const GEO_OPTIONS: readonly SelectOption[] = GEO_KINDS.map((kind) => ({
  value: kind,
  label: kind.charAt(0).toUpperCase() + kind.slice(1),
}));

const ARROWHEAD_OPTIONS: readonly SelectOption[] = ARROWHEADS.map((head) => ({
  value: head,
  label: head.charAt(0).toUpperCase() + head.slice(1),
}));

const ASSOCIATION_OPTIONS: readonly SelectOption[] = UML_ASSOCIATION_KINDS.map(
  (kind) => ({
    value: kind,
    label:
      kind === "assoc"
        ? "Association"
        : kind === "aggregate"
          ? "Aggregation"
          : kind === "compose"
            ? "Composition"
            : "Inheritance",
  }),
);

const PAGE_KIND_OPTIONS: readonly SelectOption[] = PAGE_KINDS.map((kind) => ({
  value: kind,
  label: kind.charAt(0).toUpperCase() + kind.slice(1),
}));
const FRAME_PLATFORM_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Unspecified" },
  ...FRAME_PLATFORMS.map((platform) => ({
    value: platform,
    label:
      platform === "ios"
        ? "iOS"
        : platform.charAt(0).toUpperCase() + platform.slice(1),
  })),
];
const RESPONSIVE_PRESET_OPTIONS: readonly SelectOption[] = Object.entries(
  FRAME_PRESETS,
).map(([value, preset]) => ({
  value,
  label: `${preset.name} (${preset.width} × ${preset.height})`,
}));
export function GeoSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  return (
    <Section title="Shape">
      <Field label="Kind">
        <SelectInput
          label="Shape kind"
          value={stringOf(semantic(), "geo") || "rect"}
          options={GEO_OPTIONS}
          onCommit={(geo) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              geo,
            })
          }
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
    </Section>
  );
}

export function NodeSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  return (
    <Section title="Node">
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              label,
            })
          }
        />
      </Field>
    </Section>
  );
}

export function SequenceParticipantSection(
  props: ElementSectionProps,
): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const position = () =>
    props.editor.store
      .getPageElements(props.element.page)
      .filter((element) => element.type === "sequence.participant")
      .sort(
        (left, right) =>
          compareFractional(
            stringOf(record(left.semantic), "order"),
            stringOf(record(right.semantic), "order"),
          ) || compareFractional(left.id, right.id),
      )
      .findIndex((element) => element.id === props.element.id);
  const count = () =>
    props.editor.store
      .getPageElements(props.element.page)
      .filter((element) => element.type === "sequence.participant").length;
  return (
    <Section title="Sequence participant">
      <Field label="Name">
        <TextInput
          label="Participant name"
          value={stringOf(semantic(), "name")}
          onCommit={(name) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              name,
            })
          }
        />
      </Field>
      <Field label="Kind">
        <SelectInput
          label="Participant kind"
          value={stringOf(semantic(), "kind") || "service"}
          options={PARTICIPANT_KINDS.map((kind) => ({
            value: kind,
            label: kind.charAt(0).toUpperCase() + kind.slice(1),
          }))}
          onCommit={(kind) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              kind,
            })
          }
        />
      </Field>
      <div>
        <button
          type="button"
          class="diagra-inspector-button"
          disabled={position() <= 0}
          onClick={() => props.editor.moveSequenceElement(props.element.id, -1)}
        >
          Move left
        </button>
        <button
          type="button"
          class="diagra-inspector-button"
          disabled={position() < 0 || position() >= count() - 1}
          onClick={() => props.editor.moveSequenceElement(props.element.id, 1)}
        >
          Move right
        </button>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => {
          const id = props.editor.createSequenceActivation(props.element.id);
          if (id) props.editor.selection.set([id]);
        }}
      >
        Add activation
      </button>
    </Section>
  );
}

export function SequenceMessageSection(
  props: ElementSectionProps,
): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const position = () =>
    props.editor.store
      .getPageElements(props.element.page)
      .filter((element) => element.type === "sequence.message")
      .sort(
        (left, right) =>
          compareFractional(
            stringOf(record(left.semantic), "order"),
            stringOf(record(right.semantic), "order"),
          ) || compareFractional(left.id, right.id),
      )
      .findIndex((element) => element.id === props.element.id);
  const count = () =>
    props.editor.store
      .getPageElements(props.element.page)
      .filter((element) => element.type === "sequence.message").length;
  return (
    <Section title="Sequence message">
      <Field label="Label">
        <TextInput
          label="Message label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
      <Field label="Kind">
        <SelectInput
          label="Message kind"
          value={stringOf(semantic(), "kind") || "sync"}
          options={MESSAGE_KINDS.map((kind) => ({
            value: kind,
            label: kind.charAt(0).toUpperCase() + kind.slice(1),
          }))}
          onCommit={(kind) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              kind,
            })
          }
        />
      </Field>
      <div>
        <button
          type="button"
          class="diagra-inspector-button"
          disabled={position() <= 0}
          onClick={() => props.editor.moveSequenceElement(props.element.id, -1)}
        >
          Earlier
        </button>
        <button
          type="button"
          class="diagra-inspector-button"
          disabled={position() < 0 || position() >= count() - 1}
          onClick={() => props.editor.moveSequenceElement(props.element.id, 1)}
        >
          Later
        </button>
      </div>
    </Section>
  );
}

export function FrameSection(props: ElementSectionProps): JSX.Element {
  const [refreshStatus, setRefreshStatus] = createSignal("");
  const [variantPropertyName, setVariantPropertyName] = createSignal("");
  const [variantPropertyValue, setVariantPropertyValue] = createSignal("");
  const [responsivePreset, setResponsivePreset] =
    createSignal<FramePresetKey>("iphone");
  const semantic = () => props.element.semantic as FrameSemantic;
  const responsiveSourceName = (id: string): string => {
    const source = props.editor.store.get(id);
    return source ? layerName(source) : id;
  };
  const updateSafeArea = (
    side: "top" | "right" | "bottom" | "left",
    value: number,
  ): void => {
    writeSemantic(props.editor, props.element.id, {
      ...semantic(),
      safeArea: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...semantic().safeArea,
        [side]: value,
      },
    });
  };
  const layout = (): FrameLayout =>
    semantic().layout ?? {
      direction: "vertical",
      gap: 16,
      padding: 24,
      sizing: "fixed",
      align: "start",
    };
  const updateLayout = (patch: Partial<FrameLayout>): void => {
    const parents = frameParents(
      props.editor.store,
      props.element.page,
      props.editor.createShapeContext(),
    );
    const memberIds =
      semantic().memberIds ??
      [...parents]
        .filter(([, parent]) => parent === props.element.id)
        .map(([child]) => child);
    const nextSemantic = {
      ...semantic(),
      memberIds,
      layout: { ...layout(), ...patch },
    };
    const links = { ...props.element.visual.numberTokens };
    for (const field of [
      "gap",
      "crossGap",
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ] as const) {
      if (Object.hasOwn(patch, field)) delete links[field];
    }
    const { numberTokens: _old, ...rest } = props.element.visual;
    const nextVisual = {
      ...rest,
      ...(Object.keys(links).length ? { numberTokens: links } : {}),
    };
    props.editor.apply([
      { type: "updateSemantic", id: props.element.id, semantic: nextSemantic },
      { type: "replaceVisual", id: props.element.id, visual: nextVisual },
    ]);
  };
  const updateGrid = (index: number, patch: Partial<LayoutGrid>): void => {
    const grid = semantic().layoutGrids?.[index];
    if (!grid) return;
    updateLayoutGrid(props.editor, props.element.id, index, {
      ...grid,
      ...patch,
    } as LayoutGrid);
  };
  return (
    <Section title="Artboard">
      <button
        type="button"
        class="diagra-tool-button"
        disabled={
          artboardOrientationIssue(props.editor, props.element.id) !== null
        }
        title={
          artboardOrientationIssue(props.editor, props.element.id) ??
          "Swap width and height and reflow contents"
        }
        onClick={() => swapArtboardOrientation(props.editor, props.element.id)}
      >
        Swap width / height
      </button>
      <Field label="Target">
        <SelectInput
          label="Target platform"
          value={semantic().platform ?? ""}
          options={FRAME_PLATFORM_OPTIONS}
          onCommit={(platform) => {
            const { platform: _old, ...rest } = semantic();
            writeSemantic(props.editor, props.element.id, {
              ...rest,
              ...(platform ? { platform: platform as FramePlatform } : {}),
            });
          }}
        />
      </Field>
      <label>
        <input
          type="checkbox"
          checked={semantic().showTitle !== false}
          onChange={(event) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              showTitle: event.currentTarget.checked,
            })
          }
        />
        Show artboard title
      </label>
      <details>
        <summary>Device safe area</summary>
        <label>
          <input
            type="checkbox"
            checked={semantic().safeArea !== undefined}
            onChange={(event) => {
              if (event.currentTarget.checked) {
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
                });
              } else {
                const { safeArea: _old, ...rest } = semantic();
                writeSemantic(props.editor, props.element.id, rest);
              }
            }}
          />
          Enable safe area
        </label>
        <Show when={semantic().safeArea}>
          <div class="diagra-inspector-grid-2">
            <Field label="Top">
              <NumberInput
                label="Safe area top inset"
                min={0}
                value={semantic().safeArea?.top ?? 0}
                onCommit={(value) => updateSafeArea("top", value)}
              />
            </Field>
            <Field label="Right">
              <NumberInput
                label="Safe area right inset"
                min={0}
                value={semantic().safeArea?.right ?? 0}
                onCommit={(value) => updateSafeArea("right", value)}
              />
            </Field>
            <Field label="Bottom">
              <NumberInput
                label="Safe area bottom inset"
                min={0}
                value={semantic().safeArea?.bottom ?? 0}
                onCommit={(value) => updateSafeArea("bottom", value)}
              />
            </Field>
            <Field label="Left">
              <NumberInput
                label="Safe area left inset"
                min={0}
                value={semantic().safeArea?.left ?? 0}
                onCommit={(value) => updateSafeArea("left", value)}
              />
            </Field>
          </div>
        </Show>
      </details>
      <Show when={!semantic().component && !semantic().instanceOf}>
        <details>
          <summary>Responsive variants</summary>
          <p class="diagra-inspector-note">
            Clone this artboard beside the source and reflow its contents
            through their resize constraints and auto layout.
          </p>
          <Field label="Target size">
            <SelectInput
              label="Responsive variant target"
              value={responsivePreset()}
              options={RESPONSIVE_PRESET_OPTIONS}
              onCommit={(value) => setResponsivePreset(value as FramePresetKey)}
            />
          </Field>
          <button
            type="button"
            class="diagra-inspector-button"
            onClick={() =>
              props.editor.createResponsiveVariant(
                props.element.id,
                responsivePreset(),
              )
            }
          >
            Create responsive copy
          </button>
        </details>
      </Show>
      <Show when={semantic().responsiveSource} keyed>
        {(sourceId) => (
          <details open>
            <summary>Responsive source</summary>
            <p class="diagra-inspector-note">
              {`Linked to ${responsiveSourceName(sourceId)}. Refresh inherits source text, rich-text marks, paint, typography and token links while preserving this artboard's geometry and local overrides.`}
            </p>
            <div class="diagra-inspector-actions">
              <button
                type="button"
                class="diagra-inspector-button"
                onClick={() =>
                  setRefreshStatus(
                    props.editor.refreshResponsiveVariant(props.element.id)
                      ? "Inherited responsive content refreshed."
                      : "Refresh unavailable: check source, bindings or locks.",
                  )
                }
              >
                Refresh inherited content
              </button>
              <button
                type="button"
                class="diagra-inspector-button"
                onClick={() =>
                  setRefreshStatus(
                    props.editor.updateResponsiveStructure(props.element.id)
                      ? "Responsive structure updated; breakpoint layout and overrides preserved."
                      : "Update unavailable: check source, bindings, duplicate keys or locks.",
                  )
                }
              >
                Update responsive structure
              </button>
              <button
                type="button"
                class="diagra-inspector-button"
                onClick={() =>
                  props.editor.detachResponsiveVariant(props.element.id)
                }
              >
                Detach responsive source
              </button>
            </div>
            <p class="diagra-inspector-note">
              Structure update adds and removes source layers while retaining
              surviving IDs, this breakpoint&apos;s geometry, and locally added
              layers. New layers reflow through their responsive constraints.
            </p>
            <p role="status">{refreshStatus()}</p>
          </details>
        )}
      </Show>
      <label>
        <input
          type="checkbox"
          checked={semantic().clipContent === true}
          onChange={(event) => {
            const parents = frameParents(
              props.editor.store,
              props.element.page,
              props.editor.createShapeContext(),
            );
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              clipContent: event.currentTarget.checked,
              memberIds:
                semantic().memberIds ??
                [...parents]
                  .filter(([, parent]) => parent === props.element.id)
                  .map(([child]) => child),
            });
          }}
        />
        Clip contents (rectangular)
      </label>
      <details>
        <summary>Layout grids ({semantic().layoutGrids?.length ?? 0})</summary>
        <For each={semantic().layoutGrids ?? []}>
          {(grid, index) => (
            <details>
              <summary>
                {grid.kind === "grid"
                  ? "Square grid"
                  : grid.kind === "columns"
                    ? "Columns"
                    : "Rows"}
              </summary>
              <label>
                <input
                  type="checkbox"
                  checked={grid.visible !== false}
                  onChange={(event) =>
                    updateGrid(index(), {
                      visible: event.currentTarget.checked,
                    })
                  }
                />
                Visible on canvas
              </label>
              <Field label="Color">
                <input
                  type="color"
                  aria-label={`${grid.kind} layout grid color`}
                  value={grid.color}
                  onChange={(event) =>
                    updateGrid(index(), { color: event.currentTarget.value })
                  }
                />
              </Field>
              <Field label="Opacity">
                <NumberInput
                  label={`${grid.kind} layout grid opacity`}
                  min={0}
                  max={1}
                  step={0.05}
                  value={grid.opacity}
                  onCommit={(opacity) => updateGrid(index(), { opacity })}
                />
              </Field>
              <Show
                when={grid.kind === "grid" ? grid : undefined}
                fallback={
                  <>
                    <Field label="Count">
                      <NumberInput
                        label={`${grid.kind} layout grid count`}
                        min={1}
                        max={24}
                        value={"count" in grid ? grid.count : 1}
                        onCommit={(count) => updateGrid(index(), { count })}
                      />
                    </Field>
                    <Field label="Gutter">
                      <NumberInput
                        label={`${grid.kind} layout grid gutter`}
                        min={0}
                        value={"gutter" in grid ? grid.gutter : 0}
                        onCommit={(gutter) => updateGrid(index(), { gutter })}
                      />
                    </Field>
                    <Field label="Margin">
                      <NumberInput
                        label={`${grid.kind} layout grid margin`}
                        min={0}
                        value={"margin" in grid ? grid.margin : 0}
                        onCommit={(margin) => updateGrid(index(), { margin })}
                      />
                    </Field>
                  </>
                }
              >
                {(square) => (
                  <Field label="Size">
                    <NumberInput
                      label="Square layout grid size"
                      min={1}
                      value={square().size}
                      onCommit={(size) => updateGrid(index(), { size })}
                    />
                  </Field>
                )}
              </Show>
              <button
                type="button"
                class="diagra-inspector-button"
                onClick={() =>
                  removeLayoutGrid(props.editor, props.element.id, index())
                }
              >
                Remove grid
              </button>
            </details>
          )}
        </For>
        <div class="diagra-inspector-actions">
          <For each={["grid", "columns", "rows"] as const}>
            {(kind) => (
              <button
                type="button"
                disabled={
                  (semantic().layoutGrids?.length ?? 0) >= MAX_LAYOUT_GRIDS
                }
                onClick={() =>
                  addLayoutGrid(props.editor, props.element.id, kind)
                }
              >
                Add {kind}
              </button>
            )}
          </For>
        </div>
      </details>
      <label>
        <input
          type="checkbox"
          checked={semantic().prototypeStart === true}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            const frames = props.editor
              .getSnapshot()
              .elements.filter(
                (item) =>
                  item.type === "frame" &&
                  (item.id === props.element.id ||
                    (enabled &&
                      (item.semantic as FrameSemantic).prototypeStart)),
              );
            props.editor.apply(
              frames.map((item) => ({
                type: "updateSemantic",
                id: item.id,
                semantic: {
                  ...(item.semantic as FrameSemantic),
                  prototypeStart: item.id === props.element.id && enabled,
                },
              })),
            );
          }}
        />
        Prototype starting screen
      </label>
      <Field label="Preview overflow">
        <SelectInput
          label="Prototype preview overflow"
          value={semantic().prototypeOverflow ?? "none"}
          options={[
            { value: "none", label: "No scrolling" },
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
            { value: "both", label: "Both axes" },
          ]}
          onCommit={(value) => {
            const { prototypeOverflow: _old, ...rest } = semantic();
            writeSemantic(props.editor, props.element.id, {
              ...rest,
              ...(value !== "none" ? { prototypeOverflow: value } : {}),
            });
          }}
        />
      </Field>
      <Show when={!semantic().component && !semantic().instanceOf}>
        <button
          type="button"
          class="diagra-inspector-button"
          onClick={() => props.editor.makeComponent(props.element.id)}
        >
          Create component
        </button>
      </Show>
      <Show when={semantic().component}>
        <Field label="Variant family">
          <TextInput
            label="Variant family"
            value={semantic().variantSet ?? ""}
            onCommit={(value) =>
              writeSemantic(
                props.editor,
                props.element.id,
                withOptionalString(
                  record(props.element.semantic),
                  "variantSet",
                  value.trim(),
                ),
              )
            }
          />
        </Field>
        <Field label="Variant name">
          <TextInput
            label="Variant name"
            value={semantic().variantName ?? ""}
            onCommit={(value) =>
              writeSemantic(
                props.editor,
                props.element.id,
                withOptionalString(
                  record(props.element.semantic),
                  "variantName",
                  value.trim(),
                ),
              )
            }
          />
        </Field>
        <details>
          <summary>
            Variant properties ({semantic().variantProperties?.length ?? 0})
          </summary>
          <For each={semantic().variantProperties ?? []}>
            {(property) => (
              <div class="diagra-inspector-stack">
                <Field label="Property">
                  <TextInput
                    label={`Rename variant property ${property.name}`}
                    value={property.name}
                    onCommit={(name) =>
                      updateComponentVariantProperty(
                        props.editor,
                        props.element.id,
                        property.id,
                        name,
                        property.value,
                      )
                    }
                  />
                </Field>
                <Field label="Value">
                  <TextInput
                    label={`${property.name} variant value`}
                    value={property.value}
                    onCommit={(value) =>
                      updateComponentVariantProperty(
                        props.editor,
                        props.element.id,
                        property.id,
                        property.name,
                        value,
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    removeComponentVariantProperty(
                      props.editor,
                      props.element.id,
                      property.id,
                    )
                  }
                >
                  Remove property
                </button>
              </div>
            )}
          </For>
          <Field label="New property">
            <TextInput
              label="New variant property name"
              placeholder="State"
              value={variantPropertyName()}
              onCommit={setVariantPropertyName}
            />
          </Field>
          <Field label="Initial value">
            <TextInput
              label="New variant property value"
              placeholder="Default"
              value={variantPropertyValue()}
              onCommit={setVariantPropertyValue}
            />
          </Field>
          <button
            type="button"
            disabled={
              !variantPropertyName().trim() ||
              !variantPropertyValue().trim() ||
              (semantic().variantProperties?.length ?? 0) >=
                MAX_VARIANT_PROPERTIES
            }
            onClick={() => {
              if (
                addComponentVariantProperty(
                  props.editor,
                  props.element.id,
                  variantPropertyName(),
                  variantPropertyValue(),
                )
              ) {
                setVariantPropertyName("");
                setVariantPropertyValue("");
              }
            }}
          >
            Add variant property
          </button>
        </details>
        <button
          type="button"
          class="diagra-inspector-button"
          onClick={() => props.editor.createComponentInstance(props.element.id)}
        >
          Create instance
        </button>
      </Show>
      <Show when={semantic().instanceOf}>
        <Show
          when={
            componentVariantAxes(props.editor, semantic().instanceOf ?? "")
              .length
          }
        >
          <For
            each={componentVariantAxes(
              props.editor,
              semantic().instanceOf ?? "",
            )}
          >
            {(axis) => (
              <Field label={axis.name}>
                <SelectInput
                  label={`${axis.name} component variant`}
                  value={axis.value}
                  options={axis.values.map((value) => ({
                    value,
                    label: value,
                  }))}
                  onCommit={(value) =>
                    setRefreshStatus(
                      switchComponentVariantProperty(
                        props.editor,
                        props.element.id,
                        axis.name,
                        value,
                      )
                        ? `${axis.name} switched. Undo restores the previous contents.`
                        : "Variant combination unavailable: check duplicate combinations, layer keys or locks.",
                    )
                  }
                />
              </Field>
            )}
          </For>
        </Show>
        <Show
          when={
            componentVariantAxes(props.editor, semantic().instanceOf ?? "")
              .length === 0 &&
            componentVariants(props.editor, semantic().instanceOf ?? "")
              .length > 1
          }
        >
          <Field label="Variant">
            <SelectInput
              label="Component variant"
              value={semantic().instanceOf ?? ""}
              options={componentVariants(
                props.editor,
                semantic().instanceOf ?? "",
              ).map((variant) => ({
                value: variant.id,
                label: `${variant.label} · ${variant.page}`,
              }))}
              onCommit={(sourceId) =>
                setRefreshStatus(
                  props.editor.switchComponentVariant(
                    props.element.id,
                    sourceId,
                  )
                    ? "Variant switched. Undo restores the previous contents."
                    : "Variant switch unavailable: check duplicate layer keys, locked contents or source.",
                )
              }
            />
          </Field>
        </Show>
        <Show
          when={
            componentVariants(props.editor, semantic().instanceOf ?? "")
              .length > 1
          }
        >
          <p class="diagra-inspector-note">
            Unique matching layer keys preserve child IDs and text/style
            overrides. Unmatched layers are replaced. The new variant supplies
            geometry; root position is preserved.
          </p>
        </Show>
        <p class="diagra-inspector-note">
          Component instance. Reset replaces its contents with the source
          design.
        </p>
        <Show when={semantic().instanceBindings?.length}>
          <label>
            <input
              type="checkbox"
              checked={semantic().autoRefresh === true}
              onChange={(event) =>
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  autoRefresh: event.currentTarget.checked,
                })
              }
            />
            Automatically refresh component
          </label>
          <p class="diagra-inspector-note">
            Source edits update inherited fields and layer structure in the same
            undo step. Locked contents, invalid tracking or cyclic dependencies
            pause automatic refresh.
          </p>
          <button
            type="button"
            class="diagra-inspector-button"
            onClick={() =>
              setRefreshStatus(
                props.editor.refreshComponentInstance(props.element.id)
                  ? "Inherited fields refreshed; overrides preserved."
                  : "Refresh unavailable: check locked descendants, source, or tracking data.",
              )
            }
          >
            Refresh inherited fields
          </button>
          <p role="status">{refreshStatus()}</p>
          <p class="diagra-inspector-note">
            Refresh preserves customized text, style and geometry fields plus
            child IDs. Use Update structure for an explicit source-tree update.
          </p>
          <button
            type="button"
            class="diagra-inspector-button"
            onClick={() =>
              setRefreshStatus(
                props.editor.updateComponentStructure(props.element.id)
                  ? "Structure updated; surviving overrides preserved."
                  : "Update unavailable: check locked contents, duplicate keys or tracking.",
              )
            }
          >
            Update structure
          </button>
          <p class="diagra-inspector-note">
            Update structure adopts source geometry and layer membership.
            Surviving tracked layers keep their IDs and text/style/geometry
            overrides. Locally added layers are retained; if their source parent
            disappears, they move to the instance root. Removed source layers
            are removed. Undo restores the previous structure.
          </p>
        </Show>
        <button
          type="button"
          class="diagra-inspector-button"
          onClick={() => props.editor.resetComponentInstance(props.element.id)}
        >
          Reset from component
        </button>
        <button
          type="button"
          class="diagra-inspector-button"
          onClick={() => props.editor.detachComponentInstance(props.element.id)}
        >
          Detach instance
        </button>
      </Show>
      <Field label="Name">
        <TextInput
          label="Artboard name"
          value={stringOf(props.element.semantic, "name")}
          onCommit={(name) =>
            writeSemantic(props.editor, props.element.id, {
              ...record(props.element.semantic),
              name,
            })
          }
        />
      </Field>
      <Field label="Auto layout">
        <SelectInput
          label="Auto layout direction"
          value={semantic().layout?.direction ?? "none"}
          options={[
            { value: "none", label: "None" },
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
          ]}
          onCommit={(direction) => {
            if (direction === "none") {
              const { layout: _layout, ...rest } = semantic();
              writeSemantic(props.editor, props.element.id, rest);
            } else
              updateLayout({
                direction: direction as FrameLayout["direction"],
              });
          }}
        />
      </Field>
      <Field label="Gap">
        <NumberInput
          label="Layout gap"
          min={0}
          value={layout().gap}
          onCommit={(gap) => updateLayout({ gap })}
        />
      </Field>
      <Field label="Wrap">
        <SelectInput
          label="Auto layout wrapping"
          value={layout().wrap ? "wrap" : "nowrap"}
          options={[
            { value: "nowrap", label: "No wrap" },
            { value: "wrap", label: "Wrap" },
          ]}
          onCommit={(value) =>
            updateLayout({ wrap: value === "wrap" ? true : undefined })
          }
        />
      </Field>
      <Show when={layout().wrap}>
        <Field label="Row / column gap">
          <NumberInput
            label="Wrapped line gap"
            min={0}
            value={layout().crossGap ?? layout().gap}
            onCommit={(crossGap) => updateLayout({ crossGap })}
          />
          <button
            type="button"
            disabled={layout().crossGap === undefined}
            onClick={() => updateLayout({ crossGap: undefined })}
          >
            Use gap
          </button>
        </Field>
      </Show>
      <Field label="Padding">
        <NumberInput
          label="Layout padding"
          min={0}
          value={layout().padding}
          onCommit={(padding) => updateLayout({ padding })}
        />
      </Field>
      <details>
        <summary>Individual padding</summary>
        <For
          each={
            [
              "paddingTop",
              "paddingRight",
              "paddingBottom",
              "paddingLeft",
            ] as const
          }
        >
          {(side) => (
            <Field label={side.slice(7)}>
              <NumberInput
                label={`Layout ${side.slice(7).toLowerCase()} padding`}
                min={0}
                value={layout()[side] ?? layout().padding}
                onCommit={(value) => updateLayout({ [side]: value })}
              />
              <button
                type="button"
                disabled={layout()[side] === undefined}
                onClick={() => updateLayout({ [side]: undefined })}
              >
                Use default
              </button>
            </Field>
          )}
        </For>
      </details>
      <Field label="Sizing">
        <SelectInput
          label="Default layout sizing"
          value={layout().sizing}
          options={[
            { value: "fixed", label: "Fixed dimensions" },
            { value: "hug", label: "Hug contents" },
          ]}
          onCommit={(sizing) =>
            updateLayout({ sizing: sizing as FrameLayout["sizing"] })
          }
        />
      </Field>
      <For each={["widthSizing", "heightSizing"] as const}>
        {(axis) => (
          <Field
            label={axis === "widthSizing" ? "Width sizing" : "Height sizing"}
          >
            <SelectInput
              label={
                axis === "widthSizing"
                  ? "Layout width sizing"
                  : "Layout height sizing"
              }
              value={layout()[axis] ?? "default"}
              options={[
                { value: "default", label: "Use default sizing" },
                { value: "fixed", label: "Fixed" },
                { value: "hug", label: "Hug contents" },
              ]}
              onCommit={(value) =>
                updateLayout({
                  [axis]:
                    value === "default"
                      ? undefined
                      : (value as "fixed" | "hug"),
                })
              }
            />
          </Field>
        )}
      </For>
      <Field label="Align">
        <SelectInput
          label="Layout alignment"
          value={layout().align}
          options={[
            { value: "start", label: "Start" },
            { value: "center", label: "Center" },
            { value: "end", label: "End" },
            { value: "stretch", label: "Stretch (fixed cross axis)" },
          ]}
          onCommit={(align) =>
            updateLayout({ align: align as FrameLayout["align"] })
          }
        />
      </Field>
      <Field label="Distribute">
        <SelectInput
          label="Layout main-axis distribution"
          value={layout().justify ?? "start"}
          options={[
            { value: "start", label: "Start" },
            { value: "center", label: "Center" },
            { value: "end", label: "End" },
            { value: "space-between", label: "Space between" },
          ]}
          onCommit={(justify) =>
            updateLayout({
              justify: justify as NonNullable<FrameLayout["justify"]>,
            })
          }
        />
      </Field>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => {
          const ids = props.editor.store
            .getPageElements(props.element.page)
            .filter((item) => {
              if (item.id === props.element.id) return false;
              const parent = frameParents(
                props.editor.store,
                item.page,
                props.editor.createShapeContext(),
              ).get(item.id);
              return parent === props.element.id;
            })
            .map((item) => item.id);
          writeSemantic(props.editor, props.element.id, {
            ...semantic(),
            memberIds: ids,
          });
        }}
      >
        Keep contents attached
      </button>
    </Section>
  );
}

export function TextNoteSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const text = () => stringOf(semantic(), "text");
  const marks = () => textNoteMarks(props.element.semantic);
  const [selection, setSelection] = createSignal({ start: 0, end: 0 });
  const [href, setHref] = createSignal("");
  const hasSelection = () => selection().end > selection().start;
  const toggle = (kind: TextMarkKind): void => {
    const range = selection();
    props.editor.toggleTextMark(props.element.id, range.start, range.end, kind);
  };
  const active = (kind: TextMarkKind): boolean => {
    const range = selection();
    return textRangeHasMark(text(), marks(), range.start, range.end, kind);
  };
  return (
    <Section title="Text">
      <TextArea
        label="Text"
        rows={5}
        value={text()}
        onCommit={(value) => props.editor.setText(props.element.id, value)}
        onSelectionChange={(start, end) => setSelection({ start, end })}
      />
      <p class="diagra-inspector-note">
        Select characters above, then apply inline formatting.
      </p>
      <div
        class="diagra-rich-text-controls"
        role="toolbar"
        aria-label="Rich text"
      >
        <For each={["bold", "italic", "underline", "code", "strike"] as const}>
          {(kind) => (
            <button
              type="button"
              aria-pressed={active(kind)}
              disabled={!hasSelection()}
              onClick={() => toggle(kind)}
            >
              {kind === "bold"
                ? "Bold"
                : kind === "italic"
                  ? "Italic"
                  : kind === "underline"
                    ? "Underline"
                    : kind === "code"
                      ? "Code"
                      : "Strike"}
            </button>
          )}
        </For>
      </div>
      <Field label="Link">
        <TextInput
          label="Selected text link"
          value={href()}
          placeholder="https://example.com"
          onCommit={setHref}
          disabled={!hasSelection()}
        />
      </Field>
      <div class="diagra-rich-text-controls">
        <button
          type="button"
          disabled={!hasSelection() || href().trim() === ""}
          onClick={() => {
            const range = selection();
            props.editor.toggleTextMark(
              props.element.id,
              range.start,
              range.end,
              "link",
              href(),
            );
          }}
        >
          Apply link
        </button>
        <button
          type="button"
          disabled={!hasSelection() || !active("link")}
          onClick={() => {
            const range = selection();
            props.editor.setRichText(
              props.element.id,
              text(),
              removeTextMarkRange(
                text(),
                marks(),
                range.start,
                range.end,
                "link",
              ),
            );
          }}
        >
          Remove link
        </button>
        <button
          type="button"
          disabled={!hasSelection()}
          onClick={() => {
            const range = selection();
            props.editor.setRichText(
              props.element.id,
              text(),
              removeTextMarkRange(text(), marks(), range.start, range.end),
            );
          }}
        >
          Clear formatting
        </button>
      </div>
    </Section>
  );
}

export function EdgeSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const arrowheads = () => record(semantic()["arrowheads"]);
  const setArrowhead = (end: "start" | "end", value: string): void => {
    writeSemantic(props.editor, props.element.id, {
      ...semantic(),
      arrowheads: { ...arrowheads(), [end]: value },
    });
  };
  return (
    <Section title="Edge">
      <label>
        <input
          type="checkbox"
          checked={semantic()["prototype"] === true}
          onChange={(event) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              prototype: event.currentTarget.checked,
            })
          }
        />
        Prototype interaction
      </label>
      <p class="diagra-inspector-note">
        Connect a layer to a screen or overlay, connect a component instance to
        a compatible variant, or connect an overlay control back to its overlay
        frame to close it.
      </p>
      <Show when={semantic()["prototype"] === true}>
        <Field label="Action">
          <SelectInput
            label="Prototype action"
            value={stringOf(semantic(), "prototypeAction") || "navigate"}
            options={[
              { value: "navigate", label: "Navigate to screen" },
              { value: "change-to", label: "Change component variant" },
              { value: "open-overlay", label: "Open overlay" },
              { value: "close-overlay", label: "Close overlay" },
            ]}
            onCommit={(prototypeAction) =>
              writeSemantic(props.editor, props.element.id, {
                ...semantic(),
                prototypeAction,
              })
            }
          />
        </Field>
        <Show when={semantic()["prototypeAction"] === "open-overlay"}>
          <Field label="Position">
            <SelectInput
              label="Overlay position"
              value={
                stringOf(semantic(), "prototypeOverlayPosition") || "center"
              }
              options={[
                { value: "center", label: "Centered" },
                { value: "top-left", label: "Top left" },
                { value: "manual", label: "Manual" },
              ]}
              onCommit={(prototypeOverlayPosition) =>
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  prototypeOverlayPosition,
                })
              }
            />
          </Field>
          <Show when={semantic()["prototypeOverlayPosition"] === "manual"}>
            <Field label="Overlay X">
              <NumberInput
                label="Overlay X position"
                value={
                  typeof semantic()["prototypeOverlayX"] === "number"
                    ? (semantic()["prototypeOverlayX"] as number)
                    : 0
                }
                onCommit={(prototypeOverlayX) =>
                  writeSemantic(props.editor, props.element.id, {
                    ...semantic(),
                    prototypeOverlayX,
                  })
                }
              />
            </Field>
            <Field label="Overlay Y">
              <NumberInput
                label="Overlay Y position"
                value={
                  typeof semantic()["prototypeOverlayY"] === "number"
                    ? (semantic()["prototypeOverlayY"] as number)
                    : 0
                }
                onCommit={(prototypeOverlayY) =>
                  writeSemantic(props.editor, props.element.id, {
                    ...semantic(),
                    prototypeOverlayY,
                  })
                }
              />
            </Field>
          </Show>
          <label>
            <input
              type="checkbox"
              checked={semantic()["prototypeOverlayBackdrop"] === true}
              onChange={(event) =>
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  prototypeOverlayBackdrop: event.currentTarget.checked,
                })
              }
            />
            Dim background
          </label>
          <label>
            <input
              type="checkbox"
              checked={semantic()["prototypeOverlayDismiss"] === true}
              onChange={(event) =>
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  prototypeOverlayDismiss: event.currentTarget.checked,
                })
              }
            />
            Close when clicking outside
          </label>
        </Show>
        <Field label="Trigger">
          <SelectInput
            label="Prototype trigger"
            value={stringOf(semantic(), "prototypeTrigger") || "click"}
            options={[
              { value: "click", label: "Click / tap" },
              { value: "hover", label: "While hovering" },
              { value: "press", label: "Pointer down" },
              { value: "after-delay", label: "After delay" },
            ]}
            onCommit={(prototypeTrigger) =>
              writeSemantic(props.editor, props.element.id, {
                ...semantic(),
                prototypeTrigger,
                ...(prototypeTrigger === "after-delay" &&
                typeof semantic()["prototypeDelay"] !== "number"
                  ? { prototypeDelay: 1000 }
                  : {}),
              })
            }
          />
        </Field>
        <Show when={semantic()["prototypeTrigger"] === "after-delay"}>
          <Field label="Delay (ms)">
            <NumberInput
              label="Prototype trigger delay"
              min={100}
              value={
                typeof semantic()["prototypeDelay"] === "number"
                  ? (semantic()["prototypeDelay"] as number)
                  : 1000
              }
              onCommit={(value) =>
                writeSemantic(props.editor, props.element.id, {
                  ...semantic(),
                  prototypeDelay: Math.min(60_000, value),
                })
              }
            />
          </Field>
        </Show>
        <Field label="Transition">
          <SelectInput
            label="Prototype transition"
            value={stringOf(semantic(), "prototypeTransition") || "instant"}
            options={[
              { value: "instant", label: "Instant" },
              { value: "fade", label: "Fade in" },
              { value: "slide-left", label: "Slide in from right" },
              { value: "slide-right", label: "Slide in from left" },
              { value: "smart", label: "Smart animate layers" },
            ]}
            onCommit={(prototypeTransition) =>
              writeSemantic(props.editor, props.element.id, {
                ...semantic(),
                prototypeTransition,
              })
            }
          />
        </Field>
        <Field label="Duration (ms)">
          <NumberInput
            label="Prototype duration"
            min={0}
            value={
              typeof semantic()["prototypeDuration"] === "number"
                ? (semantic()["prototypeDuration"] as number)
                : 250
            }
            onCommit={(value) =>
              writeSemantic(props.editor, props.element.id, {
                ...semantic(),
                prototypeDuration: Math.min(5000, value),
              })
            }
          />
        </Field>
      </Show>
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
      <Suspense>
        <ConnectorRoutingFields
          semantic={semantic()}
          write={(next) => writeSemantic(props.editor, props.element.id, next)}
        />
      </Suspense>
      <Field label="Start">
        <SelectInput
          label="Start arrowhead"
          value={stringOf(arrowheads(), "start") || "none"}
          options={ARROWHEAD_OPTIONS}
          onCommit={(value) => setArrowhead("start", value)}
        />
      </Field>
      <Field label="End">
        <SelectInput
          label="End arrowhead"
          value={stringOf(arrowheads(), "end") || "arrow"}
          options={ARROWHEAD_OPTIONS}
          onCommit={(value) => setArrowhead("end", value)}
        />
      </Field>
    </Section>
  );
}

export function AssociationSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const cardinalities = () => record(semantic()["cardinalities"]);
  const setCardinality = (end: "from" | "to", value: string): void => {
    const next = withOptionalString(cardinalities(), end, value);
    const { cardinalities: _dropped, ...rest } = semantic();
    writeSemantic(
      props.editor,
      props.element.id,
      Object.keys(next).length === 0 ? rest : { ...rest, cardinalities: next },
    );
  };
  return (
    <Section title="Association">
      <Field label="Kind">
        <SelectInput
          label="Association kind"
          value={stringOf(semantic(), "kind") || "assoc"}
          options={ASSOCIATION_OPTIONS}
          onCommit={(kind) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              kind,
            })
          }
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
      <Suspense>
        <ConnectorRoutingFields
          semantic={semantic()}
          write={(next) => writeSemantic(props.editor, props.element.id, next)}
        />
      </Suspense>
      <Field label="From">
        <TextInput
          label="From cardinality"
          placeholder="e.g. 1"
          value={stringOf(cardinalities(), "from")}
          onCommit={(value) => setCardinality("from", value)}
        />
      </Field>
      <Field label="To">
        <TextInput
          label="To cardinality"
          placeholder="e.g. 0..*"
          value={stringOf(cardinalities(), "to")}
          onCommit={(value) => setCardinality("to", value)}
        />
      </Field>
    </Section>
  );
}

export function GroupSection(props: ElementSectionProps): JSX.Element {
  const count = () => memberIdsOf(props.element).length;
  const semantic = () => props.element.semantic as GroupSemantic;
  const mask = () => semantic().maskId ?? "";
  const booleanOperation = () => semantic().booleanOperation ?? "";
  const style = () => props.element.visual.style ?? {};
  const candidates = () => groupMaskCandidates(props.editor, props.element.id);
  const compositing = () =>
    !semantic().isolate && !style().blendMode
      ? "pass-through"
      : (style().blendMode ?? "normal");
  const setCompositing = (value: string): void => {
    const { style: _style, ...rest } = props.element.visual;
    const { isolate: _isolate, ...semanticRest } = semantic();
    const { blendMode: _blendMode, ...styleRest } = style();
    const nextStyle =
      value === "pass-through" || value === "normal"
        ? styleRest
        : { ...styleRest, blendMode: value as BlendMode };
    props.editor.apply([
      {
        type: "updateSemantic",
        id: props.element.id,
        semantic:
          value === "pass-through"
            ? semanticRest
            : { ...semanticRest, isolate: true },
      },
      {
        type: "replaceVisual",
        id: props.element.id,
        visual: {
          ...rest,
          ...(Object.keys(nextStyle).length ? { style: nextStyle } : {}),
        },
      },
    ]);
  };
  const setOpacity = (percent: number): void => {
    const { style: _style, ...rest } = props.element.visual;
    const { opacity: _opacity, ...styleRest } = style();
    const nextStyle =
      percent >= 100
        ? styleRest
        : { ...styleRest, opacity: Math.max(0, percent) / 100 };
    props.editor.apply([
      {
        type: "replaceVisual",
        id: props.element.id,
        visual: {
          ...rest,
          ...(Object.keys(nextStyle).length ? { style: nextStyle } : {}),
        },
      },
    ]);
  };
  return (
    <Section title="Group">
      <p class="diagra-inspector-note">
        {count() === 1 ? "1 member" : `${count()} members`}
      </p>
      <Field label="Layer mask">
        <select
          aria-label="Group layer mask"
          value={mask()}
          onChange={(event) =>
            setGroupMask(
              props.editor,
              props.element.id,
              event.currentTarget.value || null,
            )
          }
        >
          <option value="">No mask</option>
          <For each={candidates()}>
            {(element) => (
              <option value={element.id}>{layerName(element)}</option>
            )}
          </For>
        </select>
      </Field>
      <p class="diagra-inspector-note">
        The mask layer stays editable in Layers but does not paint. Convex
        shapes and ordinary box layers are supported.
      </p>
      <Field label="Boolean operation">
        <SelectInput
          label="Group Boolean operation"
          value={booleanOperation()}
          options={[
            { value: "", label: "None" },
            ...BOOLEAN_OPERATIONS.map((value) => ({
              value,
              label: `${value[0]?.toUpperCase()}${value.slice(1)}`,
            })),
          ]}
          onCommit={(value) =>
            setGroupBooleanOperation(
              props.editor,
              props.element.id,
              (value || null) as BooleanOperation | null,
            )
          }
        />
      </Field>
      <p class="diagra-inspector-note">
        Boolean groups combine ordered, editable convex members. Subtract uses
        the first member as its base.
      </p>
      <Field label="Compositing">
        <SelectInput
          label="Group compositing mode"
          value={compositing()}
          options={[
            { value: "pass-through", label: "Pass through" },
            ...BLEND_MODES.map((value) => ({
              value,
              label: value
                .split("-")
                .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
                .join(" "),
            })),
          ]}
          onCommit={setCompositing}
        />
      </Field>
      <NumberInput
        label="Group opacity percent"
        min={0}
        max={100}
        value={Math.round((style().opacity ?? 1) * 100)}
        onCommit={setOpacity}
      />
      <button
        type="button"
        class="diagra-inspector-button"
        title="Ungroup (Cmd+Shift+G)"
        onClick={() => props.editor.ungroupSelection()}
      >
        Ungroup
      </button>
    </Section>
  );
}

export interface PageSectionProps {
  readonly editor: Editor;
  readonly page: Page;
}

export function PageSection(props: PageSectionProps): JSX.Element {
  return (
    <Section title="Page">
      <Field label="Name">
        <TextInput
          label="Page name"
          value={props.page.name}
          onCommit={(name) => props.editor.renamePage(props.page.id, name)}
        />
      </Field>
      <Field label="Kind">
        <SelectInput
          label="Page kind"
          value={props.page.kind}
          options={PAGE_KIND_OPTIONS}
          onCommit={(kind) =>
            props.editor.setPageKind(props.page.id, kind as PageKind)
          }
        />
      </Field>
      <Suspense>
        <PageGuidesSection editor={props.editor} page={props.page} />
      </Suspense>
      <p class="diagra-inspector-note">
        Select an element to edit its content and style.
      </p>
    </Section>
  );
}
