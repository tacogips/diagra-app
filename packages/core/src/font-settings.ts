import type {
  FontFeatureSetting,
  FontVariationAxis,
  VisualStyle,
} from "@diagra/ir";

function safeSettings(
  settings:
    | readonly FontVariationAxis[]
    | readonly FontFeatureSetting[]
    | undefined,
  integer: boolean,
): string | undefined {
  if (!settings?.length) return undefined;
  const entries = settings.flatMap((setting) =>
    /^[A-Za-z0-9]{4}$/.test(setting.tag) &&
    Number.isFinite(setting.value) &&
    (!integer || (Number.isInteger(setting.value) && setting.value >= 0))
      ? [`"${setting.tag}" ${setting.value}`]
      : [],
  );
  return entries.length ? entries.join(", ") : undefined;
}

export function fontVariationCss(
  style: VisualStyle | undefined,
): string | undefined {
  return safeSettings(style?.fontVariations, false);
}

export function fontFeatureCss(
  style: VisualStyle | undefined,
): string | undefined {
  return safeSettings(style?.fontFeatures, true);
}
