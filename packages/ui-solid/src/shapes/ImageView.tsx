import {
  cornerRadiiCss,
  croppedImageBox,
  resolvedCornerRadii,
} from "@nodetto/core";
import { isRasterDataUrl, type Element, type ImageSemantic } from "@nodetto/ir";
import type { JSX } from "solid-js";
import { strokeBorderStyle } from "./visual.ts";

export function ImageView(props: {
  element: Element;
  resolveAsset?: (source: string) => string | undefined;
}): JSX.Element {
  const semantic = () => props.element.semantic as ImageSemantic;
  const cropBox = () => {
    const crop = semantic().crop;
    return crop
      ? croppedImageBox(crop, { x: 0, y: 0, width: 100, height: 100 })
      : null;
  };
  const imageStyle = () => {
    const box = cropBox();
    return {
      position: box ? "absolute" : "static",
      left: box ? `${box.x}%` : undefined,
      top: box ? `${box.y}%` : undefined,
      width: box ? `${box.width}%` : "100%",
      height: box ? `${box.height}%` : "100%",
      display: "block",
      "object-fit": box ? "fill" : (semantic().fit ?? "contain"),
    } as const;
  };
  return (
    <div
      data-smart-paint="box"
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        "box-sizing": "border-box",
        "border-radius": cornerRadiiCss(
          resolvedCornerRadii(props.element.visual.style),
        ),
        ...(props.element.visual.style?.stroke ||
        props.element.visual.style?.strokeGradient
          ? {
              border: `${props.element.visual.style?.strokeWidth ?? 1}px solid transparent`,
            }
          : {}),
        ...strokeBorderStyle(props.element.visual),
      }}
    >
      <img
        src={
          props.resolveAsset
            ? props.resolveAsset(semantic().src)
            : isRasterDataUrl(semantic().src)
              ? semantic().src
              : undefined
        }
        alt={semantic().alt}
        draggable={false}
        style={imageStyle()}
      />
    </div>
  );
}
