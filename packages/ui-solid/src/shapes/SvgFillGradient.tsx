import {
  angularGradientPatches,
  diamondGradientPatches,
  gradientId,
  linearGradientVector,
  sampleGradient,
  strokeGradientId,
} from "@diagra/core";
import type { Element, FillGradient } from "@diagra/ir";
import { For, type JSX, Match, Show, Switch } from "solid-js";

function GradientDefinition(props: {
  readonly id: string;
  readonly paintRole: "fill" | "stroke";
  readonly gradient: FillGradient;
  readonly width: number;
  readonly height: number;
}): JSX.Element {
  const vector = () =>
    props.gradient.type === "linear"
      ? linearGradientVector(props.gradient.angle, props.width, props.height)
      : undefined;
  return (
    <Switch>
      <Match when={props.gradient.type === "linear"}>
        <linearGradient
          id={props.id}
          data-smart-gradient={props.paintRole}
          data-smart-width={props.width}
          data-smart-height={props.height}
          {...vector()}
        >
          <For each={props.gradient.stops}>
            {(stop) => (
              <stop
                offset={stop.offset}
                stop-color={stop.color}
                stop-opacity={stop.opacity ?? 1}
              />
            )}
          </For>
        </linearGradient>
      </Match>
      <Match when={props.gradient.type === "radial"}>
        <radialGradient
          id={props.id}
          data-smart-gradient={props.paintRole}
          data-smart-width={props.width}
          data-smart-height={props.height}
          cx={props.gradient.type === "radial" ? props.gradient.centerX : 0.5}
          cy={props.gradient.type === "radial" ? props.gradient.centerY : 0.5}
          r={props.gradient.type === "radial" ? props.gradient.radius : 0.5}
        >
          <For each={props.gradient.stops}>
            {(stop) => (
              <stop
                offset={stop.offset}
                stop-color={stop.color}
                stop-opacity={stop.opacity ?? 1}
              />
            )}
          </For>
        </radialGradient>
      </Match>
      <Match when={props.gradient.type === "angular"}>
        <pattern
          id={props.id}
          patternUnits="userSpaceOnUse"
          width={props.width}
          height={props.height}
        >
          <For
            each={
              props.gradient.type === "angular"
                ? angularGradientPatches(
                    props.gradient,
                    props.width,
                    props.height,
                  )
                : []
            }
          >
            {(patch) => (
              <polygon
                points={patch.points}
                fill={patch.color}
                fill-opacity={patch.opacity}
              />
            )}
          </For>
        </pattern>
      </Match>
      <Match when={props.gradient.type === "diamond"}>
        <pattern
          id={props.id}
          patternUnits="userSpaceOnUse"
          width={props.width}
          height={props.height}
        >
          <rect
            width={props.width}
            height={props.height}
            fill={sampleGradient(props.gradient.stops, 1).color}
            fill-opacity={sampleGradient(props.gradient.stops, 1).opacity}
          />
          <For
            each={
              props.gradient.type === "diamond"
                ? diamondGradientPatches(
                    props.gradient,
                    props.width,
                    props.height,
                  )
                : []
            }
          >
            {(patch) => (
              <polygon
                points={patch.points}
                fill={patch.color}
                fill-opacity={patch.opacity}
              />
            )}
          </For>
        </pattern>
      </Match>
    </Switch>
  );
}

/** Inline SVG paint definition for geometric canvas shapes. */
export function SvgFillGradient(props: {
  readonly element: Element;
  readonly width: number;
  readonly height: number;
}): JSX.Element {
  const fill = () => props.element.visual.style?.fillGradient;
  const stroke = () => props.element.visual.style?.strokeGradient;
  return (
    <Show when={fill() || stroke()}>
      <defs>
        <Show when={fill()}>
          {(paint) => (
            <GradientDefinition
              id={gradientId(props.element.id)}
              paintRole="fill"
              gradient={paint()}
              width={props.width}
              height={props.height}
            />
          )}
        </Show>
        <Show when={stroke()}>
          {(paint) => (
            <GradientDefinition
              id={strokeGradientId(props.element.id)}
              paintRole="stroke"
              gradient={paint()}
              width={props.width}
              height={props.height}
            />
          )}
        </Show>
      </defs>
    </Show>
  );
}
