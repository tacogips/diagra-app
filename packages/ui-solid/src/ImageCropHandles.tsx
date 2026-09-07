import {
  boxCenter,
  CommandError,
  composeImageCrop,
  cropFromCorners,
  type Box,
  type Editor,
  rotatePoint,
  type Vec,
} from "@diagra/core";
import type { Element, ImageCrop, ImageSemantic } from "@diagra/ir";
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";

type Corner = "nw" | "ne" | "se" | "sw";
const CORNERS: readonly Corner[] = ["nw", "ne", "se", "sw"];

function cornerPoint(box: Box, corner: Corner): Vec {
  return {
    x: corner.includes("w") ? box.x : box.x + box.width,
    y: corner.includes("n") ? box.y : box.y + box.height,
  };
}

function opposite(corner: Corner): Corner {
  return ({ nw: "se", ne: "sw", se: "nw", sw: "ne" } as const)[corner];
}

function cropBox(box: Box, crop: ImageCrop): Box {
  return {
    x: box.x + crop.x * box.width,
    y: box.y + crop.y * box.height,
    width: crop.width * box.width,
    height: crop.height * box.height,
  };
}

export function ImageCropHandles(props: {
  readonly editor: Editor;
  readonly element: Element;
  readonly box: Box;
  readonly zoom: number;
  readonly toPage: (event: PointerEvent) => Vec;
}): JSX.Element {
  const [preview, setPreview] = createSignal<ImageCrop | null>(null);
  let pointerId: number | null = null;
  let fixed: Vec | null = null;
  const rotation = () => props.element.visual.rotation ?? 0;
  const localPoint = (event: PointerEvent) =>
    rotatePoint(props.toPage(event), boxCenter(props.box), -rotation());
  const cancel = (): void => {
    pointerId = null;
    fixed = null;
    setPreview(null);
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cancel();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  onCleanup(() => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
  });
  const move = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId || !fixed) return;
    setPreview(cropFromCorners(fixed, localPoint(event), props.box));
  };
  const finish = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId || !fixed) return;
    const trim = cropFromCorners(fixed, localPoint(event), props.box);
    const semantic = props.element.semantic as ImageSemantic;
    const crop = composeImageCrop(semantic.crop, trim);
    cancel();
    if (trim.x === 0 && trim.y === 0 && trim.width === 1 && trim.height === 1)
      return;
    try {
      props.editor.apply([
        {
          type: "updateSemantic",
          id: props.element.id,
          semantic: { ...semantic, crop },
        },
      ]);
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
    }
  };
  const shownBox = () =>
    cropBox(props.box, preview() ?? { x: 0, y: 0, width: 1, height: 1 });
  const size = () => 10 / props.zoom;
  return (
    <g
      transform={
        rotation()
          ? `rotate(${rotation()} ${boxCenter(props.box).x} ${boxCenter(props.box).y})`
          : undefined
      }
      onPointerMove={(event) => {
        event.stopPropagation();
        move(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        finish(event);
      }}
      onPointerCancel={(event) => {
        if (pointerId === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (pointerId === event.pointerId) cancel();
      }}
    >
      <Show when={preview()}>
        <path
          class="diagra-crop-mask"
          d={`M ${props.box.x} ${props.box.y} h ${props.box.width} v ${props.box.height} h ${-props.box.width} Z M ${shownBox().x} ${shownBox().y} v ${shownBox().height} h ${shownBox().width} v ${-shownBox().height} Z`}
          fill-rule="evenodd"
        />
      </Show>
      <rect
        class="diagra-crop-outline"
        {...shownBox()}
        vector-effect="non-scaling-stroke"
      />
      <For each={CORNERS}>
        {(corner) => {
          const point = () => cornerPoint(shownBox(), corner);
          return (
            <rect
              class="diagra-crop-handle"
              x={point().x - size() / 2}
              y={point().y - size() / 2}
              width={size()}
              height={size()}
              vector-effect="non-scaling-stroke"
              style={{
                cursor: `${corner === "nw" || corner === "se" ? "nwse" : "nesw"}-resize`,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0 || pointerId !== null) return;
                event.preventDefault();
                pointerId = event.pointerId;
                fixed = cornerPoint(props.box, opposite(corner));
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >
              <title>Trim image from the {corner} corner; Escape cancels</title>
            </rect>
          );
        }}
      </For>
    </g>
  );
}
