import { fullImageCrop, MIN_IMAGE_CROP, type Editor } from "@diagra/core";
import type { Element, ImageSemantic } from "@diagra/ir";
import { createSignal, type JSX, Show } from "solid-js";
import { replaceRasterFile } from "../image-import.ts";
import {
  Field,
  NumberInput,
  Section,
  SelectInput,
  TextInput,
} from "./controls.tsx";
import { writeSemantic } from "./write.ts";

export function ImageSection(props: {
  editor: Editor;
  element: Element;
}): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let input: HTMLInputElement | undefined;
  const replace = async (file: File): Promise<void> => {
    const id = props.element.id;
    setBusy(true);
    setError("");
    try {
      await replaceRasterFile(props.editor, id, file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const semantic = () => props.element.semantic as ImageSemantic;
  const crop = () => semantic().crop ?? fullImageCrop();
  const writeCrop = (
    field: "x" | "y" | "width" | "height",
    percent: number,
  ) => {
    const current = crop();
    const raw = percent / 100;
    const next = {
      ...current,
      [field]:
        field === "x"
          ? Math.min(raw, 1 - current.width)
          : field === "y"
            ? Math.min(raw, 1 - current.height)
            : field === "width"
              ? Math.min(Math.max(MIN_IMAGE_CROP, raw), 1 - current.x)
              : Math.min(Math.max(MIN_IMAGE_CROP, raw), 1 - current.y),
    };
    writeSemantic(props.editor, props.element.id, {
      ...semantic(),
      crop: next,
    });
  };
  return (
    <Section title="Image">
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void replace(file);
        }}
      />
      <button
        type="button"
        class="diagra-tool-button"
        disabled={busy()}
        onClick={() => input?.click()}
      >
        {busy() ? "Replacing image…" : "Replace image"}
      </button>
      <Show when={error()}>
        <span role="alert">{error()}</span>
      </Show>
      <Field label="Description">
        <TextInput
          label="Image description"
          value={semantic().alt}
          onCommit={(alt) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              alt,
            })
          }
        />
      </Field>
      <Field label="Fit">
        <SelectInput
          label="Image fit"
          disabled={semantic().crop !== undefined}
          value={semantic().fit ?? "contain"}
          options={[
            { value: "contain", label: "Contain" },
            { value: "cover", label: "Cover" },
            { value: "fill", label: "Stretch" },
          ]}
          onCommit={(fit) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              fit,
            })
          }
        />
      </Field>
      <Field label="Crop X / Y">
        <div class="diagra-inline-fields">
          <NumberInput
            label="Crop left percent"
            value={Math.round(crop().x * 10000) / 100}
            min={0}
            max={(1 - crop().width) * 100}
            step={0.1}
            onCommit={(value) => writeCrop("x", value)}
          />
          <NumberInput
            label="Crop top percent"
            value={Math.round(crop().y * 10000) / 100}
            min={0}
            max={(1 - crop().height) * 100}
            step={0.1}
            onCommit={(value) => writeCrop("y", value)}
          />
        </div>
      </Field>
      <Field label="Crop W / H">
        <div class="diagra-inline-fields">
          <NumberInput
            label="Crop width percent"
            value={Math.round(crop().width * 10000) / 100}
            min={MIN_IMAGE_CROP * 100}
            max={(1 - crop().x) * 100}
            step={0.1}
            onCommit={(value) => writeCrop("width", value)}
          />
          <NumberInput
            label="Crop height percent"
            value={Math.round(crop().height * 10000) / 100}
            min={MIN_IMAGE_CROP * 100}
            max={(1 - crop().y) * 100}
            step={0.1}
            onCommit={(value) => writeCrop("height", value)}
          />
        </div>
      </Field>
      <button
        type="button"
        class="diagra-tool-button"
        disabled={!semantic().crop}
        onClick={() => {
          const { crop: _crop, ...rest } = semantic();
          writeSemantic(props.editor, props.element.id, rest);
        }}
      >
        Reset crop
      </button>
    </Section>
  );
}
