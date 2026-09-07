import { expect, test } from "bun:test";
import { gradientCss, gradientId, strokeGradientId } from "@diagra/core";
import type { FillGradient, Visual } from "@diagra/ir";
import {
  fillPaint,
  fillPaintStyle,
  layerAppearanceStyle,
  strokeBorderStyle,
  svgStyle,
  typographyStyle,
} from "./shapes/visual.ts";

const gradient: FillGradient = {
  type: "linear",
  angle: 45,
  stops: [
    { offset: 0, color: "#123456" },
    { offset: 1, color: "#abcdef", opacity: 0.25 },
  ],
};

test("HTML and inline SVG shape paint helpers share the stored gradient", () => {
  const visual: Visual = {
    style: { fill: "#123456", fillGradient: gradient, stroke: "#000000" },
  };
  expect(fillPaint(visual)).toBe(gradientCss(gradient));
  expect(svgStyle(visual, "shape/雪")).toMatchObject({
    fill: `url(#${gradientId("shape/雪")})`,
    stroke: "#000000",
  });
  expect(svgStyle(visual).fill).toBe("#123456");
});

test("advanced HTML paints size native and SVG-backed backgrounds to the layer", () => {
  const angular: FillGradient = {
    type: "angular",
    centerX: 0.5,
    centerY: 0.5,
    angle: 30,
    stops: gradient.stops,
  };
  const diamond: FillGradient = {
    type: "diamond",
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.75,
    angle: 45,
    stops: gradient.stops,
  };
  expect(fillPaintStyle({ style: { fillGradient: angular } })).toMatchObject({
    "background-image": gradientCss(angular),
    "background-size": "100% 100%",
    "background-repeat": "no-repeat",
  });
  expect(
    fillPaintStyle({ style: { fill: "#123456", fillGradient: diamond } }),
  ).toMatchObject({
    "background-color": "#123456",
    "background-image": gradientCss(diamond),
    "background-position": "center",
  });
});

test("layer opacity and effects live on the animatable wrapper", () => {
  const visual = {
    rotation: 25,
    style: {
      opacity: 0.4,
      effects: [
        { type: "layer-blur" as const, blur: 2 },
        { type: "background-blur" as const, blur: 8 },
      ],
    },
  };
  expect(layerAppearanceStyle(visual)).toEqual({
    transform: "rotate(25deg)",
    opacity: 0.4,
    filter: "blur(2px)",
    "backdrop-filter": "blur(8px)",
    "mix-blend-mode": "normal",
  });
  expect(svgStyle(visual)).not.toHaveProperty("opacity");
});

test("stroke gradients drive SVG strokes and HTML border images", () => {
  const visual: Visual = {
    style: {
      stroke: "#123456",
      strokeWidth: 3,
      strokeGradient: gradient,
    },
  };
  expect(svgStyle(visual, "outline").stroke).toBe(
    `url(#${strokeGradientId("outline")})`,
  );
  expect(svgStyle(visual).stroke).toBe("#123456");
  expect(strokeBorderStyle(visual)).toMatchObject({
    "border-color": "transparent",
    "border-image-source": gradientCss(gradient),
    "border-image-slice": 1,
    "border-width": "3px",
  });
});

test("advanced font settings reach HTML text without unsafe raw syntax", () => {
  expect(
    typographyStyle({
      style: {
        fontVariations: [
          { tag: "wght", value: 625 },
          { tag: "wdth", value: 95 },
        ],
        fontFeatures: [
          { tag: "liga", value: 0 },
          { tag: "ss01", value: 1 },
        ],
      },
    }),
  ).toMatchObject({
    "font-variation-settings": '"wght" 625, "wdth" 95',
    "font-feature-settings": '"liga" 0, "ss01" 1',
  });
});

test("inline SVG paint carries authored stroke geometry", () => {
  expect(
    svgStyle({
      style: {
        strokeCap: "square",
        strokeJoin: "bevel",
        strokeMiterLimit: 7,
      },
    }),
  ).toMatchObject({
    "stroke-linecap": "square",
    "stroke-linejoin": "bevel",
    "stroke-miterlimit": 7,
  });
});
