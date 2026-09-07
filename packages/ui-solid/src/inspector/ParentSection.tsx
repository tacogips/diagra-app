import {
  CommandError,
  type Editor,
  expandContainers,
  frameParents,
  groupOf,
} from "@diagra/core";
import type { Element, FrameSemantic, Visual } from "@diagra/ir";
import { createSignal, For, type JSX, Show } from "solid-js";
import {
  Field,
  Section,
  SelectInput,
  TextInput,
  NumberInput,
} from "./controls.tsx";

export function ParentSection(props: {
  readonly editor: Editor;
  readonly element: Element;
}): JSX.Element {
  const [message, setMessage] = createSignal("");
  const parent = () =>
    frameParents(
      props.editor.store,
      props.element.page,
      props.editor.createShapeContext(),
    ).get(props.element.id);
  const options = () => {
    const context = props.editor.createShapeContext();
    const descendants = new Set(
      expandContainers(props.editor.store, [props.element.id], context),
    );
    return [
      { value: "", label: "Page (no frame)" },
      ...props.editor.store
        .getPageElements(props.element.page)
        .filter(
          (item) =>
            item.type === "frame" &&
            !descendants.has(item.id) &&
            !context.isLocked?.(item.id),
        )
        .map((item) => ({
          value: item.id,
          label: (item.semantic as FrameSemantic).name || "Artboard",
        })),
    ];
  };
  const parentLayout = () => {
    const id = parent();
    const frame = id ? props.editor.store.get(id) : undefined;
    return frame?.type === "frame"
      ? (frame.semantic as FrameSemantic).layout
      : undefined;
  };
  const ownLayout = () =>
    props.element.type === "frame"
      ? (props.element.semantic as FrameSemantic).layout
      : undefined;
  const writeSizeLimit = (
    field: "minWidth" | "maxWidth" | "minHeight" | "maxHeight",
    raw: string,
  ): void => {
    const value = raw.trim() === "" ? undefined : Number(raw);
    if (value !== undefined && (!Number.isFinite(value) || value < 1)) return;
    const {
      [field]: _old,
      numberTokens: oldLinks,
      ...visual
    } = props.element.visual;
    const links = { ...oldLinks };
    delete links[field];
    try {
      props.editor.apply([
        {
          type: "replaceVisual",
          id: props.element.id,
          visual: {
            ...visual,
            ...(value === undefined ? {} : { [field]: value }),
            ...(Object.keys(links).length ? { numberTokens: links } : {}),
          } as Visual,
        },
      ]);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
    }
  };
  const constraintOptions = ["start", "end", "center", "stretch", "scale"].map(
    (value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
    }),
  );
  const constrain = (
    axis: "horizontalConstraint" | "verticalConstraint",
    mode: string,
  ): void => {
    const parentId = parent();
    const frame = parentId ? props.editor.store.get(parentId) : undefined;
    if (!frame) return;
    const semantic = frame.semantic as FrameSemantic;
    const parents = frameParents(
      props.editor.store,
      frame.page,
      props.editor.createShapeContext(),
    );
    const memberIds =
      semantic.memberIds ??
      [...parents].filter(([, owner]) => owner === frame.id).map(([id]) => id);
    props.editor.apply([
      {
        type: "updateSemantic",
        id: frame.id,
        semantic: { ...semantic, memberIds },
      },
      { type: "updateVisual", id: props.element.id, visual: { [axis]: mode } },
    ]);
  };
  return (
    <Section title="Frame membership">
      <Show when={parentLayout()}>
        <Field label="Layout position">
          <SelectInput
            label="Position inside auto layout"
            value={props.element.visual.layoutPosition ?? "flow"}
            options={[
              { value: "flow", label: "Auto layout" },
              { value: "absolute", label: "Absolute overlay" },
            ]}
            onCommit={(value) => {
              const { layoutPosition: _old, ...visual } = props.element.visual;
              props.editor.apply([
                {
                  type: "replaceVisual",
                  id: props.element.id,
                  visual:
                    value === "absolute"
                      ? { ...visual, layoutPosition: "absolute" }
                      : visual,
                },
              ]);
            }}
          />
        </Field>
      </Show>
      <Field label="Layout fill weight">
        <NumberInput
          label="Layout fill weight"
          min={0}
          disabled={props.element.visual.layoutPosition === "absolute"}
          value={props.element.visual.layoutGrow ?? 0}
          onCommit={(layoutGrow) =>
            props.editor.apply([
              {
                type: "updateVisual",
                id: props.element.id,
                visual: { layoutGrow },
              },
            ])
          }
        />
      </Field>
      <p>
        0 keeps the current size. Positive weights share remaining space along a
        fixed auto-layout parent's main axis. Hug-sized axes and absolute
        overlays are not filled.
      </p>
      <Show
        when={
          parentLayout() ||
          ownLayout() ||
          props.element.visual.textResize === "auto-width" ||
          props.element.visual.textResize === "auto-height"
        }
      >
        <div class="diagra-field-grid">
          <For
            each={
              [
                ["minWidth", "Minimum width"],
                ["maxWidth", "Maximum width"],
                ["minHeight", "Minimum height"],
                ["maxHeight", "Maximum height"],
              ] as const
            }
          >
            {([field, label]) => (
              <Field label={label}>
                <TextInput
                  label={label}
                  placeholder="None"
                  value={
                    props.element.visual[field] === undefined
                      ? ""
                      : String(props.element.visual[field])
                  }
                  onCommit={(value) => writeSizeLimit(field, value)}
                />
              </Field>
            )}
          </For>
        </div>
        <p class="diagra-inspector-note">
          Optional limits constrain dimensions produced by fill, stretch, and
          hug sizing. Clear a field to remove its limit.
        </p>
      </Show>
      <Field label="Component / motion key">
        <TextInput
          label="Component or smart-animation layer key"
          value={props.element.visual.componentKey ?? ""}
          onCommit={(value) => {
            const { componentKey: _key, ...visual } = props.element.visual;
            props.editor.apply([
              {
                type: "replaceVisual",
                id: props.element.id,
                visual: value.trim()
                  ? { ...visual, componentKey: value.trim() }
                  : visual,
              },
            ]);
          }}
        />
      </Field>
      <p class="diagra-inspector-note">
        A unique matching key preserves this layer across component variants and
        moves/resizes it between prototype screens using Smart animate.
      </p>
      <Show
        when={!groupOf(props.editor.store, props.element.id)}
        fallback={
          <p class="diagra-inspector-note">
            Select the containing group to move it between artboards.
          </p>
        }
      >
        <Field label="Parent">
          <SelectInput
            label="Parent artboard"
            value={parent() ?? ""}
            options={options()}
            onCommit={(id) => {
              const changed = props.editor.reparentElement(
                props.element.id,
                id || null,
              );
              setMessage(
                changed
                  ? ""
                  : "Cannot change parent. Unlock affected frames and select the whole group when moving grouped content.",
              );
            }}
          />
        </Field>
        <Show when={message()}>
          <p role="status" class="diagra-inspector-note">
            {message()}
          </p>
        </Show>
        <Show when={parent()}>
          <Show when={props.element.visual.x !== undefined}>
            <Field label="Horizontal">
              <SelectInput
                label="Horizontal resizing constraint"
                value={props.element.visual.horizontalConstraint ?? "start"}
                options={constraintOptions}
                onCommit={(value) => constrain("horizontalConstraint", value)}
              />
            </Field>
            <Field label="Vertical">
              <SelectInput
                label="Vertical resizing constraint"
                value={props.element.visual.verticalConstraint ?? "start"}
                options={constraintOptions}
                onCommit={(value) => constrain("verticalConstraint", value)}
              />
            </Field>
            <p class="diagra-inspector-note">
              {parentLayout() &&
              props.element.visual.layoutPosition !== "absolute"
                ? "Auto-layout parents control positioning instead of these resize constraints."
                : "Constraints position and size this layer when its parent artboard is resized."}
            </p>
          </Show>
          <button
            type="button"
            class="diagra-inspector-button"
            onClick={() =>
              props.editor.reorderFrameMember(props.element.id, -1)
            }
          >
            Earlier in{" "}
            {props.element.visual.layoutPosition === "absolute"
              ? "layer order"
              : "layout"}
          </button>
          <button
            type="button"
            class="diagra-inspector-button"
            onClick={() => props.editor.reorderFrameMember(props.element.id, 1)}
          >
            Later in{" "}
            {props.element.visual.layoutPosition === "absolute"
              ? "layer order"
              : "layout"}
          </button>
        </Show>
      </Show>
    </Section>
  );
}
