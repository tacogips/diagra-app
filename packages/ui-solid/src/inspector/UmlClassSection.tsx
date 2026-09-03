// UML class section: name, stereotype, and the two member editors.
//
// Row indices for `focusRow` run through the attributes first and then the
// methods, matching the order the class box draws them in.

import { type Editor, newElementId } from "@diagra/core";
import {
  type Element,
  UML_VISIBILITIES,
  type UmlClassSemantic,
  type UmlVisibility,
} from "@diagra/ir";
import { createEffect, Index, type JSX, on } from "solid-js";
import {
  Checkbox,
  Field,
  focusRowInput,
  RowTools,
  Section,
  SelectInput,
  type SelectOption,
  TextInput,
} from "./controls.tsx";
import {
  addUmlAttribute,
  addUmlMethod,
  moveUmlAttribute,
  moveUmlMethod,
  parseParameters,
  readUmlClass,
  removeUmlAttribute,
  removeUmlMethod,
  serializeParameters,
  updateUmlAttribute,
  updateUmlMethod,
  withOptionalString,
} from "./edits.ts";
import { writeSemantic } from "./write.ts";

export interface UmlClassSectionProps {
  readonly editor: Editor;
  readonly element: Element;
  readonly focusRow?: number;
}

const VISIBILITY_OPTIONS: readonly SelectOption[] = UML_VISIBILITIES.map(
  (visibility) => ({ value: visibility, label: visibility }),
);

export function UmlClassSection(props: UmlClassSectionProps): JSX.Element {
  const semantic = (): UmlClassSemantic => readUmlClass(props.element.semantic);
  const write = (next: UmlClassSemantic): void => {
    writeSemantic(props.editor, props.element.id, next);
  };
  const attributeInputs: HTMLInputElement[] = [];
  const methodInputs: HTMLInputElement[] = [];

  createEffect(
    on(
      () => props.focusRow,
      (row) => {
        if (row === undefined) {
          return;
        }
        requestAnimationFrame(() => {
          const attributeCount = semantic().attributes.length;
          focusRowInput(
            row < attributeCount
              ? attributeInputs[row]
              : methodInputs[row - attributeCount],
          );
        });
      },
    ),
  );

  return (
    <Section title="Class">
      <Field label="Name">
        <TextInput
          label="Class name"
          value={semantic().name}
          onCommit={(name) => write({ ...semantic(), name })}
        />
      </Field>
      <Field label="Stereotype">
        <TextInput
          label="Stereotype"
          placeholder="e.g. interface"
          value={semantic().stereotype ?? ""}
          onCommit={(stereotype) =>
            write(withOptionalString(semantic(), "stereotype", stereotype))
          }
        />
      </Field>

      <h4 class="diagra-inspector-subtitle">Attributes</h4>
      <div class="diagra-rows" role="table" aria-label="Attributes">
        <div class="diagra-row diagra-row-uml diagra-row-head" role="row">
          <span title="Visibility">Vis</span>
          <span>Name</span>
          <span>Type</span>
          <span title="Static">St</span>
          <span />
        </div>
        <Index each={semantic().attributes}>
          {(attribute, index) => (
            <div class="diagra-row diagra-row-uml" role="row">
              <SelectInput
                label="Visibility"
                value={attribute().visibility ?? "+"}
                options={VISIBILITY_OPTIONS}
                onCommit={(visibility) =>
                  write(
                    updateUmlAttribute(semantic(), attribute().id, {
                      visibility: visibility as UmlVisibility,
                    }),
                  )
                }
              />
              <TextInput
                ref={(element) => {
                  attributeInputs[index] = element;
                }}
                label="Attribute name"
                value={attribute().name}
                onCommit={(name) =>
                  write(
                    updateUmlAttribute(semantic(), attribute().id, { name }),
                  )
                }
              />
              <TextInput
                label="Attribute type"
                value={attribute().type ?? ""}
                onCommit={(type) =>
                  write(
                    updateUmlAttribute(semantic(), attribute().id, { type }),
                  )
                }
              />
              <Checkbox
                label=""
                title="Static"
                checked={attribute().static === true}
                onCommit={(value) =>
                  write(
                    updateUmlAttribute(semantic(), attribute().id, {
                      static: value,
                    }),
                  )
                }
              />
              <RowTools
                canMoveUp={index > 0}
                canMoveDown={index < semantic().attributes.length - 1}
                onMove={(delta) =>
                  write(moveUmlAttribute(semantic(), attribute().id, delta))
                }
                onRemove={() =>
                  write(removeUmlAttribute(semantic(), attribute().id))
                }
              />
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => write(addUmlAttribute(semantic(), newElementId()))}
      >
        Add attribute
      </button>

      <h4 class="diagra-inspector-subtitle">Methods</h4>
      <div class="diagra-rows" role="table" aria-label="Methods">
        <Index each={semantic().methods}>
          {(method, index) => (
            <div class="diagra-method" role="row">
              <div class="diagra-row diagra-row-uml">
                <SelectInput
                  label="Visibility"
                  value={method().visibility ?? "+"}
                  options={VISIBILITY_OPTIONS}
                  onCommit={(visibility) =>
                    write(
                      updateUmlMethod(semantic(), method().id, {
                        visibility: visibility as UmlVisibility,
                      }),
                    )
                  }
                />
                <TextInput
                  ref={(element) => {
                    methodInputs[index] = element;
                  }}
                  label="Method name"
                  value={method().name}
                  onCommit={(name) =>
                    write(updateUmlMethod(semantic(), method().id, { name }))
                  }
                />
                <TextInput
                  label="Return type"
                  placeholder="returns"
                  value={method().returnType ?? ""}
                  onCommit={(returnType) =>
                    write(
                      updateUmlMethod(semantic(), method().id, { returnType }),
                    )
                  }
                />
                <span />
                <RowTools
                  canMoveUp={index > 0}
                  canMoveDown={index < semantic().methods.length - 1}
                  onMove={(delta) =>
                    write(moveUmlMethod(semantic(), method().id, delta))
                  }
                  onRemove={() =>
                    write(removeUmlMethod(semantic(), method().id))
                  }
                />
              </div>
              <div class="diagra-method-detail">
                <TextInput
                  label="Parameters"
                  placeholder="a: T, b: U"
                  value={serializeParameters(method().parameters)}
                  onCommit={(text) =>
                    write(
                      updateUmlMethod(semantic(), method().id, {
                        parameters: parseParameters(text),
                      }),
                    )
                  }
                />
                <Checkbox
                  label="static"
                  checked={method().static === true}
                  onCommit={(value) =>
                    write(
                      updateUmlMethod(semantic(), method().id, {
                        static: value,
                      }),
                    )
                  }
                />
                <Checkbox
                  label="abstract"
                  checked={method().abstract === true}
                  onCommit={(value) =>
                    write(
                      updateUmlMethod(semantic(), method().id, {
                        abstract: value,
                      }),
                    )
                  }
                />
              </div>
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => write(addUmlMethod(semantic(), newElementId()))}
      >
        Add method
      </button>
    </Section>
  );
}
