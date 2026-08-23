// uml.class: stereotype and name, then the attribute and method
// compartments. Compartment heights come from the same core helpers the
// bounds use, so the drawn box and the pickable box agree.

import {
  UML_CLASS_ROW_HEIGHT,
  umlAttributesHeight,
  umlMethodsHeight,
  umlNameHeight,
} from "@diagra/core";
import type {
  Element,
  UmlAttribute,
  UmlClassSemantic,
  UmlMethod,
} from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";

export interface UmlClassViewProps {
  readonly element: Element;
}

function semanticOf(element: Element): UmlClassSemantic {
  const semantic = element.semantic as Partial<UmlClassSemantic> | null;
  return {
    name: semantic?.name ?? "",
    ...(semantic?.stereotype === undefined
      ? {}
      : { stereotype: semantic.stereotype }),
    attributes: Array.isArray(semantic?.attributes) ? semantic.attributes : [],
    methods: Array.isArray(semantic?.methods) ? semantic.methods : [],
  };
}

function attributeText(attribute: UmlAttribute): string {
  const visibility = attribute.visibility ?? "+";
  const type = attribute.type ? `: ${attribute.type}` : "";
  return `${visibility} ${attribute.name}${type}`;
}

function methodText(method: UmlMethod): string {
  const visibility = method.visibility ?? "+";
  const parameters = (method.parameters ?? [])
    .map((parameter) =>
      parameter.type ? `${parameter.name}: ${parameter.type}` : parameter.name,
    )
    .join(", ");
  const returns = method.returnType ? `: ${method.returnType}` : "";
  return `${visibility} ${method.name}(${parameters})${returns}`;
}

export function UmlClassView(props: UmlClassViewProps): JSX.Element {
  const semantic = () => semanticOf(props.element);
  return (
    <div class="diagra-uml-class">
      <div
        class="diagra-uml-name"
        style={{ height: `${umlNameHeight(props.element.semantic)}px` }}
      >
        <Show when={semantic().stereotype}>
          {(stereotype) => (
            <span class="diagra-uml-stereotype">{`«${stereotype()}»`}</span>
          )}
        </Show>
        <span class="diagra-uml-title">{semantic().name}</span>
      </div>
      <div
        class="diagra-uml-compartment"
        style={{ height: `${umlAttributesHeight(props.element.semantic)}px` }}
      >
        <For each={semantic().attributes}>
          {(attribute) => (
            <div
              class="diagra-uml-row"
              style={{ height: `${UML_CLASS_ROW_HEIGHT}px` }}
              classList={{ "diagra-uml-static": attribute.static === true }}
            >
              {attributeText(attribute)}
            </div>
          )}
        </For>
      </div>
      <div
        class="diagra-uml-compartment"
        style={{ height: `${umlMethodsHeight(props.element.semantic)}px` }}
      >
        <For each={semantic().methods}>
          {(method) => (
            <div
              class="diagra-uml-row"
              style={{ height: `${UML_CLASS_ROW_HEIGHT}px` }}
              classList={{
                "diagra-uml-static": method.static === true,
                "diagra-uml-abstract": method.abstract === true,
              }}
            >
              {methodText(method)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
