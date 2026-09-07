import {
  cornerRadiiCss,
  fontFeatureCss,
  fontVariationCss,
  gradientCss,
  linearGradientVector,
  type PrototypeSmartPaint,
  type PrototypeSmartStep,
  roundedRectPath,
} from "@diagra/core";
import type { FillGradient, PrototypeTransition } from "@diagra/ir";

type AnimationTarget = Pick<Element, "animate"> &
  Partial<Pick<Element, "querySelectorAll">>;
type ActiveAnimation = Pick<Animation, "cancel">;

/** Destination entrance only: never interpolate unrelated screen layers. */
export function prototypeKeyframes(
  transition: PrototypeTransition,
): Keyframe[] {
  switch (transition) {
    case "fade":
      return [{ opacity: 0 }, { opacity: 1 }];
    case "slide-left":
      return [
        { transform: "translateX(100%)" },
        { transform: "translateX(0)" },
      ];
    case "slide-right":
      return [
        { transform: "translateX(-100%)" },
        { transform: "translateX(0)" },
      ];
    default:
      return [];
  }
}

export class PrototypeAnimation {
  private animations: ActiveAnimation[] = [];

  cancel(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
  }

  play(
    target: AnimationTarget | undefined,
    transition: PrototypeTransition,
    duration: number,
    reducedMotion: boolean,
  ): void {
    this.cancel();
    if (
      !target ||
      typeof target.animate !== "function" ||
      reducedMotion ||
      !Number.isFinite(duration) ||
      duration <= 0
    )
      return;
    const frames = prototypeKeyframes(transition);
    if (!frames.length) return;
    this.animations = [
      target.animate(frames, {
        duration: Math.min(5000, duration),
        easing: "ease-out",
      }),
    ];
  }

  playSmart(
    targets: ReadonlyMap<string, AnimationTarget>,
    steps: readonly PrototypeSmartStep[],
    duration: number,
    reducedMotion: boolean,
    outgoing?: AnimationTarget,
  ): void {
    this.cancel();
    if (reducedMotion || !Number.isFinite(duration) || duration <= 0) return;
    const options: KeyframeAnimationOptions = {
      duration: Math.min(5000, duration),
      easing: "ease-in-out",
    };
    for (const step of steps) {
      const target = targets.get(step.target);
      if (!target || typeof target.animate !== "function") continue;
      this.animations.push(
        target.animate(
          [
            {
              opacity: step.fadeIn ? 0 : step.opacityFrom,
              transform: `translate(${step.translateX}px, ${step.translateY}px) rotate(${step.rotateFrom}deg) scale(${step.scaleX}, ${step.scaleY})`,
              filter: step.filterFrom,
              ...(step.backdropFilterFrom === undefined
                ? {}
                : { backdropFilter: step.backdropFilterFrom }),
            },
            {
              opacity: step.opacityTo,
              transform: `translate(0px, 0px) rotate(${step.rotateTo}deg) scale(1, 1)`,
              filter: step.filterTo,
              ...(step.backdropFilterTo === undefined
                ? {}
                : { backdropFilter: step.backdropFilterTo }),
            },
          ],
          options,
        ),
      );
      if (step.paintFrom && step.paintTo) {
        this.animateSmartPaint(target, step.paintFrom, step.paintTo, options);
      }
    }
    if (outgoing && typeof outgoing.animate === "function") {
      this.animations.push(
        outgoing.animate([{ opacity: 1 }, { opacity: 0 }], options),
      );
    }
  }

  private animateSmartPaint(
    target: AnimationTarget,
    from: PrototypeSmartPaint,
    to: PrototypeSmartPaint,
    options: KeyframeAnimationOptions,
  ): void {
    const querySelectorAll = target.querySelectorAll;
    if (typeof querySelectorAll !== "function") return;
    const animate = (
      selector: string,
      fromFrame: Keyframe,
      toFrame: Keyframe,
    ): void => {
      if (!Object.keys(fromFrame).length) return;
      for (const descendant of querySelectorAll.call(target, selector)) {
        if (typeof descendant.animate !== "function") continue;
        this.animations.push(descendant.animate([fromFrame, toFrame], options));
      }
    };
    animate(
      '[data-smart-paint="box"]',
      boxPaintKeyframe(from),
      boxPaintKeyframe(to),
    );
    animate(
      '[data-smart-paint="svg"]',
      svgPaintKeyframe(from),
      svgPaintKeyframe(to),
    );
    animate(
      "[data-smart-pressure]",
      pressurePaintKeyframe(from),
      pressurePaintKeyframe(to),
    );
    animate(
      "[data-smart-radius]",
      svgRadiusKeyframe(from),
      svgRadiusKeyframe(to),
    );
    for (const descendant of querySelectorAll.call(
      target,
      "[data-smart-radius-path]",
    )) {
      if (typeof descendant.animate !== "function") continue;
      const width = Number(descendant.getAttribute("data-smart-width"));
      const height = Number(descendant.getAttribute("data-smart-height"));
      const fromFrame = svgCornerPathKeyframe(from, width, height);
      if (!Object.keys(fromFrame).length) continue;
      this.animations.push(
        descendant.animate(
          [fromFrame, svgCornerPathKeyframe(to, width, height)],
          options,
        ),
      );
    }
    animate(
      "[data-smart-text]",
      textPaintKeyframe(from),
      textPaintKeyframe(to),
    );
    this.animateSmartGradient(target, "fill", from, to, options);
    this.animateSmartGradient(target, "stroke", from, to, options);
  }

  private animateSmartGradient(
    target: AnimationTarget,
    role: "fill" | "stroke",
    from: PrototypeSmartPaint,
    to: PrototypeSmartPaint,
    options: KeyframeAnimationOptions,
  ): void {
    const fromGradient =
      role === "fill" ? from.fillGradient : from.strokeGradient;
    const toGradient = role === "fill" ? to.fillGradient : to.strokeGradient;
    if (!fromGradient || !toGradient) return;
    const definitions = target.querySelectorAll?.(
      `[data-smart-gradient="${role}"]`,
    );
    if (!definitions) return;
    for (const definition of definitions) {
      const width = Number(definition.getAttribute("data-smart-width"));
      const height = Number(definition.getAttribute("data-smart-height"));
      const fromFrame = svgGradientKeyframe(fromGradient, width, height);
      const toFrame = svgGradientKeyframe(toGradient, width, height);
      if (
        Object.keys(fromFrame).length &&
        typeof definition.animate === "function"
      )
        this.animations.push(definition.animate([fromFrame, toFrame], options));
      const stops =
        (
          definition as Element & {
            querySelectorAll?: (selector: string) => NodeListOf<Element>;
          }
        ).querySelectorAll?.("stop") ?? [];
      for (let index = 0; index < stops.length; index += 1) {
        const stop = stops[index];
        const fromStop = fromGradient.stops[index];
        const toStop = toGradient.stops[index];
        if (!stop || !fromStop || !toStop) continue;
        this.animations.push(
          stop.animate(
            [
              {
                offset: fromStop.offset,
                stopColor: fromStop.color,
                stopOpacity: fromStop.opacity ?? 1,
              } as Keyframe,
              {
                offset: toStop.offset,
                stopColor: toStop.color,
                stopOpacity: toStop.opacity ?? 1,
              } as Keyframe,
            ],
            options,
          ),
        );
      }
    }
  }
}

export function boxPaintKeyframe(paint: PrototypeSmartPaint): Keyframe {
  return {
    ...(paint.fillGradient === undefined
      ? {}
      : { backgroundImage: gradientCss(paint.fillGradient) }),
    ...(paint.fill === undefined ? {} : { backgroundColor: paint.fill }),
    ...(paint.stroke === undefined ? {} : { borderColor: paint.stroke }),
    ...(paint.strokeGradient === undefined
      ? {}
      : { borderImageSource: gradientCss(paint.strokeGradient) }),
    ...(paint.strokeWidth === undefined
      ? {}
      : { borderWidth: `${paint.strokeWidth}px` }),
    ...(paint.cornerRadii
      ? { borderRadius: cornerRadiiCss(paint.cornerRadii) }
      : paint.cornerRadius === undefined
        ? {}
        : { borderRadius: `${paint.cornerRadius}px` }),
  };
}

export function svgPaintKeyframe(paint: PrototypeSmartPaint): Keyframe {
  return {
    ...(paint.fill === undefined ? {} : { fill: paint.fill }),
    ...(paint.stroke === undefined ? {} : { stroke: paint.stroke }),
    ...(paint.strokeWidth === undefined
      ? {}
      : { strokeWidth: paint.strokeWidth }),
    ...(paint.strokeCap === undefined
      ? {}
      : { strokeLinecap: paint.strokeCap }),
    ...(paint.strokeJoin === undefined
      ? {}
      : { strokeLinejoin: paint.strokeJoin }),
    ...(paint.strokeMiterLimit === undefined
      ? {}
      : { strokeMiterlimit: paint.strokeMiterLimit }),
  };
}

/** A pressure outline renders the semantic stroke paint as an SVG fill. */
export function pressurePaintKeyframe(paint: PrototypeSmartPaint): Keyframe {
  return paint.stroke === undefined ? {} : { fill: paint.stroke };
}

export function svgRadiusKeyframe(paint: PrototypeSmartPaint): Keyframe {
  return paint.cornerRadius === undefined
    ? {}
    : ({ rx: `${paint.cornerRadius}px` } as Keyframe);
}

export function svgCornerPathKeyframe(
  paint: PrototypeSmartPaint,
  width: number,
  height: number,
): Keyframe {
  return paint.cornerRadii && width > 0 && height > 0
    ? ({
        d: `path("${roundedRectPath(
          { x: 0, y: 0, width, height },
          paint.cornerRadii,
        )}")`,
      } as Keyframe)
    : {};
}

export function textPaintKeyframe(paint: PrototypeSmartPaint): Keyframe {
  return {
    ...(paint.color === undefined ? {} : { color: paint.color }),
    ...(paint.fontSize === undefined
      ? {}
      : { fontSize: `${paint.fontSize}px` }),
    ...(paint.fontFamily === undefined ? {} : { fontFamily: paint.fontFamily }),
    ...(paint.fontWeight === undefined ? {} : { fontWeight: paint.fontWeight }),
    ...(paint.fontStyle === undefined ? {} : { fontStyle: paint.fontStyle }),
    ...(fontVariationCss(paint) === undefined
      ? {}
      : { fontVariationSettings: fontVariationCss(paint) }),
    ...(fontFeatureCss(paint) === undefined
      ? {}
      : { fontFeatureSettings: fontFeatureCss(paint) }),
    ...(paint.lineHeight === undefined ? {} : { lineHeight: paint.lineHeight }),
    ...(paint.letterSpacing === undefined
      ? {}
      : { letterSpacing: `${paint.letterSpacing}px` }),
    ...(paint.textAlign === undefined
      ? {}
      : {
          textAlign:
            paint.textAlign === "start"
              ? "left"
              : paint.textAlign === "end"
                ? "right"
                : "center",
          justifyContent:
            paint.textAlign === "start"
              ? "flex-start"
              : paint.textAlign === "end"
                ? "flex-end"
                : "center",
        }),
    ...(paint.textDecoration === undefined
      ? {}
      : { textDecoration: paint.textDecoration }),
  };
}

export function svgGradientKeyframe(
  gradient: FillGradient,
  width: number,
  height: number,
): Keyframe {
  if (gradient.type === "linear") {
    return linearGradientVector(gradient.angle, width, height) as Keyframe;
  }
  if (gradient.type === "radial") {
    return {
      cx: gradient.centerX,
      cy: gradient.centerY,
      r: gradient.radius,
    } as Keyframe;
  }
  return {};
}
