import type { DropShadowEffect, LayerEffect, VisualStyle } from "@diagra/ir";
import { type Box, unionBoxes } from "./geometry.ts";

function rgba(color: string, opacity: number): string {
  const rgb = [1, 3, 5].map((start) =>
    Number.parseInt(color.slice(start, start + 2), 16),
  );
  return `rgba(${rgb.join(", ")}, ${opacity})`;
}

export function shadowCss(shadow: VisualStyle["shadow"]): string | undefined {
  if (!shadow) return undefined;
  return `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${rgba(shadow.color, shadow.opacity)})`;
}

/** New stacks supersede, but never invalidate, the legacy single-shadow field. */
export function layerEffects(
  style: VisualStyle | undefined,
): readonly LayerEffect[] {
  if (style?.effects) return style.effects;
  return style?.shadow
    ? [{ type: "drop-shadow", ...style.shadow } satisfies DropShadowEffect]
    : [];
}

export function effectsCss(style: VisualStyle | undefined): string | undefined {
  const filters = layerEffects(style).flatMap((effect) => {
    if (effect.enabled === false || effect.type === "background-blur")
      return [];
    return [
      effect.type === "drop-shadow"
        ? `drop-shadow(${effect.x}px ${effect.y}px ${effect.blur}px ${rgba(effect.color, effect.opacity)})`
        : `blur(${effect.blur}px)`,
    ];
  });
  return filters.length ? filters.join(" ") : undefined;
}

/** Backdrop filters sample pixels behind the layer instead of its own paint. */
export function backdropEffectsCss(
  style: VisualStyle | undefined,
): string | undefined {
  const filters = layerEffects(style).flatMap((effect) =>
    effect.enabled !== false && effect.type === "background-blur"
      ? [`blur(${effect.blur}px)`]
      : [],
  );
  return filters.length ? filters.join(" ") : undefined;
}

/** Export padding covers three standard deviations of each Gaussian stage. */
export function effectsBounds(box: Box, style: VisualStyle | undefined): Box {
  let current = box;
  for (const effect of layerEffects(style)) {
    if (effect.enabled === false) continue;
    if (effect.type === "background-blur") continue;
    const spread = effect.blur * 3;
    if (effect.type === "layer-blur") {
      current = {
        x: current.x - spread,
        y: current.y - spread,
        width: current.width + spread * 2,
        height: current.height + spread * 2,
      };
      continue;
    }
    if (effect.opacity === 0) continue;
    current =
      unionBoxes([
        current,
        {
          x: current.x + effect.x - spread,
          y: current.y + effect.y - spread,
          width: current.width + spread * 2,
          height: current.height + spread * 2,
        },
      ]) ?? current;
  }
  return current;
}

/** Export padding covers three standard deviations of the Gaussian. */
export function effectBounds(box: Box, shadow: VisualStyle["shadow"]): Box {
  return effectsBounds(box, shadow ? { shadow } : undefined);
}
