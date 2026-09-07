import { expect, test } from "bun:test";
import {
  boxPaintKeyframe,
  pressurePaintKeyframe,
  PrototypeAnimation,
  prototypeKeyframes,
  svgPaintKeyframe,
  svgCornerPathKeyframe,
  svgGradientKeyframe,
  svgRadiusKeyframe,
  textPaintKeyframe,
} from "./prototype-transition.ts";

test("prototype transitions animate destination entrance without altering zoom", () => {
  expect(prototypeKeyframes("instant")).toEqual([]);
  expect(prototypeKeyframes("fade")).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  expect(prototypeKeyframes("slide-left")).toEqual([
    { transform: "translateX(100%)" },
    { transform: "translateX(0)" },
  ]);
  expect(prototypeKeyframes("slide-right")).toEqual([
    { transform: "translateX(-100%)" },
    { transform: "translateX(0)" },
  ]);
  expect(prototypeKeyframes("smart")).toEqual([]);
});

test("new navigation cancels the previous animation; reduced motion and instant skip animation", () => {
  const controller = new PrototypeAnimation();
  let cancelled = 0;
  const calls: (number | KeyframeAnimationOptions | undefined)[] = [];
  const target = {
    animate: (
      _frames: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation => {
      calls.push(options);
      return {
        cancel: () => {
          cancelled += 1;
        },
      } as Animation;
    },
  };
  controller.play(target, "fade", 250, false);
  expect(calls).toEqual([{ duration: 250, easing: "ease-out" }]);
  controller.play(target, "slide-left", 8000, false);
  expect(cancelled).toBe(1);
  expect(calls.at(-1)).toEqual({ duration: 5000, easing: "ease-out" });
  controller.play(target, "fade", 250, true);
  expect(cancelled).toBe(2);
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    controller.play(target, "fade", duration, false);
  controller.play(target, "instant", 250, false);
  controller.play(undefined, "fade", 250, false);
  expect(calls).toHaveLength(2);
  controller.play(target, "fade", 250, false);
  controller.cancel();
  controller.cancel();
  expect(cancelled).toBe(3);
});

test("smart animation moves matched layers, fades new layers and cancels as a group", () => {
  const controller = new PrototypeAnimation();
  const frames: Keyframe[][] = [];
  let cancelled = 0;
  const target = {
    animate: (keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
      frames.push(keyframes as Keyframe[]);
      return {
        cancel: () => {
          cancelled += 1;
        },
      } as Animation;
    },
  };
  controller.playSmart(
    new Map([
      ["matched", target],
      ["new", target],
    ]),
    [
      {
        target: "matched",
        translateX: -20,
        translateY: 12,
        scaleX: 0.5,
        scaleY: 2,
        rotateFrom: -10,
        rotateTo: 10,
        opacityFrom: 0.4,
        opacityTo: 0.8,
        filterFrom: "drop-shadow(0px 2px 3px #000000)",
        filterTo: "blur(2px)",
        fadeIn: false,
      },
      {
        target: "new",
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotateFrom: 0,
        rotateTo: 0,
        opacityFrom: 0,
        opacityTo: 0.6,
        filterFrom: "none",
        filterTo: "none",
        fadeIn: true,
      },
    ],
    300,
    false,
  );
  expect(frames[0]?.[0]).toEqual({
    opacity: 0.4,
    transform: "translate(-20px, 12px) rotate(-10deg) scale(0.5, 2)",
    filter: "drop-shadow(0px 2px 3px #000000)",
  });
  expect(frames[1]?.[0]?.opacity).toBe(0);
  expect(frames[0]?.[1]).toEqual({
    opacity: 0.8,
    transform: "translate(0px, 0px) rotate(10deg) scale(1, 1)",
    filter: "blur(2px)",
  });
  expect(frames[1]?.[1]?.opacity).toBe(0.6);
  controller.cancel();
  expect(cancelled).toBe(2);
  controller.playSmart(new Map([["matched", target]]), [], 300, false);
  controller.playSmart(new Map([["matched", target]]), [], 300, true);
  expect(frames).toHaveLength(2);
});

test("smart animation interpolates simple box, SVG and typography paint", () => {
  const controller = new PrototypeAnimation();
  const calls: Keyframe[][] = [];
  const descendant = {
    animate: (frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
      calls.push(frames as Keyframe[]);
      return { cancel() {} } as Animation;
    },
    getAttribute: (name: string) =>
      name === "data-smart-width" ? "200" : "100",
  };
  const target = {
    animate: descendant.animate,
    querySelectorAll: () => [descendant],
  } as unknown as HTMLElement;
  const paintFrom = {
    fill: "#ff0000",
    stroke: "#111111",
    strokeWidth: 1,
    strokeCap: "butt" as const,
    strokeJoin: "miter" as const,
    strokeMiterLimit: 4,
    cornerRadius: 4,
    color: "#222222",
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: 400,
    fontStyle: "normal" as const,
    fontVariations: [{ tag: "wght", value: 400 }],
    fontFeatures: [{ tag: "liga", value: 0 }],
    lineHeight: 1.2,
    letterSpacing: 0,
    textAlign: "start" as const,
    textDecoration: "none" as const,
  };
  const paintTo = {
    fill: "#0000ff",
    stroke: "#eeeeee",
    strokeWidth: 3,
    strokeCap: "round" as const,
    strokeJoin: "bevel" as const,
    strokeMiterLimit: 8,
    cornerRadius: 12,
    color: "#ffffff",
    fontSize: 20,
    fontFamily: "Georgia",
    fontWeight: 700,
    fontStyle: "italic" as const,
    fontVariations: [{ tag: "wght", value: 700 }],
    fontFeatures: [{ tag: "liga", value: 1 }],
    lineHeight: 1.5,
    letterSpacing: 2,
    textAlign: "middle" as const,
    textDecoration: "underline" as const,
  };
  controller.playSmart(
    new Map([["matched", target]]),
    [
      {
        target: "matched",
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotateFrom: 0,
        rotateTo: 0,
        opacityFrom: 1,
        opacityTo: 1,
        filterFrom: "none",
        filterTo: "none",
        paintFrom,
        paintTo,
        fadeIn: false,
      },
    ],
    250,
    false,
  );
  expect(calls).toHaveLength(6);
  expect(calls[1]).toEqual([
    boxPaintKeyframe(paintFrom),
    boxPaintKeyframe(paintTo),
  ]);
  expect(calls[2]).toEqual([
    svgPaintKeyframe(paintFrom),
    svgPaintKeyframe(paintTo),
  ]);
  expect(calls[3]).toEqual([
    pressurePaintKeyframe(paintFrom),
    pressurePaintKeyframe(paintTo),
  ]);
  expect(calls[4]).toEqual([
    svgRadiusKeyframe(paintFrom),
    svgRadiusKeyframe(paintTo),
  ]);
  expect(calls[5]).toEqual([
    textPaintKeyframe(paintFrom),
    textPaintKeyframe(paintTo),
  ]);
  expect(svgPaintKeyframe({ cornerRadius: 4 })).toEqual({});
  expect(textPaintKeyframe({ fill: "#ff0000" })).toEqual({});
  expect(textPaintKeyframe(paintFrom)).toMatchObject({
    fontVariationSettings: '"wght" 400',
    fontFeatureSettings: '"liga" 0',
  });
});

test("smart animation interpolates compatible HTML and SVG gradients", () => {
  const controller = new PrototypeAnimation();
  const calls = new Map<string, Keyframe[][]>();
  const animated = (name: string) => ({
    animate: (frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
      calls.set(name, [...(calls.get(name) ?? []), frames as Keyframe[]]);
      return { cancel() {} } as Animation;
    },
  });
  const definition = (name: string) => ({
    ...animated(name),
    getAttribute: (attribute: string) =>
      attribute === "data-smart-width" ? "200" : "100",
    querySelectorAll: () => [animated(`${name}-0`), animated(`${name}-1`)],
  });
  const box = animated("box");
  const fill = definition("fill");
  const stroke = definition("stroke");
  const target = {
    ...animated("wrapper"),
    querySelectorAll: (selector: string) => {
      if (selector === '[data-smart-paint="box"]') return [box];
      if (selector === '[data-smart-gradient="fill"]') return [fill];
      if (selector === '[data-smart-gradient="stroke"]') return [stroke];
      return [];
    },
  } as unknown as HTMLElement;
  const from = {
    fillGradient: {
      type: "linear" as const,
      angle: 0,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff", opacity: 0.5 },
      ],
    },
    strokeGradient: {
      type: "radial" as const,
      centerX: 0.25,
      centerY: 0.4,
      radius: 0.3,
      stops: [
        { offset: 0, color: "#111111" },
        { offset: 1, color: "#555555" },
      ],
    },
  };
  const to = {
    fillGradient: {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0.2, color: "#00ff00", opacity: 0.75 },
        { offset: 0.8, color: "#ffffff" },
      ],
    },
    strokeGradient: {
      type: "radial" as const,
      centerX: 0.75,
      centerY: 0.6,
      radius: 0.8,
      stops: [
        { offset: 0, color: "#aaaaaa" },
        { offset: 1, color: "#eeeeee", opacity: 0.25 },
      ],
    },
  };
  controller.playSmart(
    new Map([["paint", target]]),
    [
      {
        target: "paint",
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotateFrom: 0,
        rotateTo: 0,
        opacityFrom: 1,
        opacityTo: 1,
        filterFrom: "none",
        filterTo: "none",
        paintFrom: from,
        paintTo: to,
        fadeIn: false,
      },
    ],
    250,
    false,
  );
  expect(calls.get("box")?.[0]).toEqual([
    boxPaintKeyframe(from),
    boxPaintKeyframe(to),
  ]);
  expect(calls.get("fill")?.[0]).toEqual([
    svgGradientKeyframe(from.fillGradient, 200, 100),
    svgGradientKeyframe(to.fillGradient, 200, 100),
  ]);
  expect(calls.get("fill-0")?.[0]).toEqual([
    { offset: 0, stopColor: "#ff0000", stopOpacity: 1 },
    { offset: 0.2, stopColor: "#00ff00", stopOpacity: 0.75 },
  ]);
  expect(calls.get("stroke")?.[0]).toEqual([
    { cx: 0.25, cy: 0.4, r: 0.3 },
    { cx: 0.75, cy: 0.6, r: 0.8 },
  ]);
  expect(calls.get("stroke-1")?.[0]?.[1]).toEqual({
    offset: 1,
    stopColor: "#eeeeee",
    stopOpacity: 0.25,
  });
});

test("smart animation interpolates four CSS corners and a stable SVG path", () => {
  const from = {
    cornerRadii: {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    },
  };
  const to = {
    cornerRadii: {
      topLeft: 20,
      topRight: 24,
      bottomRight: 28,
      bottomLeft: 32,
    },
  };
  expect(boxPaintKeyframe(from)).toEqual({
    borderRadius: "4px 8px 12px 16px",
  });
  const fromPath = svgCornerPathKeyframe(from, 200, 100);
  const toPath = svgCornerPathKeyframe(to, 200, 100);
  expect(String(fromPath.d)).toContain('path("M 4 0 H 192');
  expect(String(toPath.d)).toContain('path("M 20 0 H 176');
  expect(svgCornerPathKeyframe(from, 0, 100)).toEqual({});

  const calls: Keyframe[][] = [];
  const descendant = {
    animate: (frames: Keyframe[] | PropertyIndexedKeyframes | null) => {
      calls.push(frames as Keyframe[]);
      return { cancel() {} } as Animation;
    },
    getAttribute: (name: string) =>
      name === "data-smart-width" ? "200" : "100",
  };
  const target = {
    animate: () => ({ cancel() {} }) as Animation,
    querySelectorAll: (selector: string) =>
      selector === "[data-smart-radius-path]" ? [descendant] : [],
  } as unknown as HTMLElement;
  new PrototypeAnimation().playSmart(
    new Map([["card", target]]),
    [
      {
        target: "card",
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotateFrom: 0,
        rotateTo: 0,
        opacityFrom: 1,
        opacityTo: 1,
        filterFrom: "none",
        filterTo: "none",
        paintFrom: from,
        paintTo: to,
        fadeIn: false,
      },
    ],
    250,
    false,
  );
  expect(calls).toEqual([[fromPath, toPath]]);
});

test("smart animation fades and cancels the noninteractive outgoing overlay", () => {
  const controller = new PrototypeAnimation();
  const frames: Keyframe[][] = [];
  let cancelled = 0;
  const outgoing = {
    animate: (keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
      frames.push(keyframes as Keyframe[]);
      return {
        cancel: () => {
          cancelled += 1;
        },
      } as Animation;
    },
  };
  controller.playSmart(new Map(), [], 300, false, outgoing);
  expect(frames).toEqual([[{ opacity: 1 }, { opacity: 0 }]]);
  controller.cancel();
  expect(cancelled).toBe(1);
  controller.playSmart(new Map(), [], 300, true, outgoing);
  controller.playSmart(new Map(), [], 0, false, outgoing);
  expect(frames).toHaveLength(1);
});
