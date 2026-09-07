import { MAX_CONNECTOR_WAYPOINTS } from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import { Checkbox, Field, NumberInput, SelectInput } from "./controls.tsx";

interface WaypointValue {
  readonly u: number;
  readonly v: number;
}

export interface ConnectorRoutingFieldsProps {
  readonly semantic: Record<string, unknown>;
  readonly write: (semantic: Record<string, unknown>) => void;
}

function waypointsOf(
  semantic: Record<string, unknown>,
): readonly WaypointValue[] {
  const value = semantic["routingWaypoints"];
  if (!Array.isArray(value)) return [];
  return value.flatMap((waypoint) => {
    if (typeof waypoint !== "object" || waypoint === null) return [];
    const { u, v } = waypoint as { u?: unknown; v?: unknown };
    return typeof u === "number" && typeof v === "number" ? [{ u, v }] : [];
  });
}

export function ConnectorRoutingFields(
  props: ConnectorRoutingFieldsProps,
): JSX.Element {
  const routing = () =>
    typeof props.semantic["routing"] === "string"
      ? (props.semantic["routing"] as string)
      : "straight";
  const waypoints = () => waypointsOf(props.semantic);
  const writeWaypoints = (next: readonly WaypointValue[]): void =>
    props.write({ ...props.semantic, routingWaypoints: next });
  const updateWaypoint = (index: number, patch: Partial<WaypointValue>): void =>
    writeWaypoints(
      waypoints().map((waypoint, at) =>
        at === index ? { ...waypoint, ...patch } : waypoint,
      ),
    );
  const moveWaypoint = (index: number, delta: number): void => {
    const next = [...waypoints()];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [waypoint] = next.splice(index, 1);
    if (!waypoint) return;
    next.splice(target, 0, waypoint);
    writeWaypoints(next);
  };
  return (
    <>
      <Field label="Route">
        <SelectInput
          label="Connector routing"
          value={routing()}
          options={[
            { value: "straight", label: "Straight" },
            { value: "orthogonal", label: "Orthogonal" },
            { value: "manual", label: "Manual waypoints" },
          ]}
          onCommit={(routing) =>
            props.write({
              ...props.semantic,
              routing,
              ...(routing === "manual" && waypoints().length === 0
                ? { routingWaypoints: [{ u: 0.5, v: 40 }] }
                : {}),
            })
          }
        />
      </Field>
      <Show when={routing() === "orthogonal"}>
        <Field label="Direction">
          <SelectInput
            label="Orthogonal routing direction"
            value={
              typeof props.semantic["routingAxis"] === "string"
                ? (props.semantic["routingAxis"] as string)
                : "auto"
            }
            options={[
              { value: "auto", label: "Automatic" },
              { value: "horizontal", label: "Horizontal first" },
              { value: "vertical", label: "Vertical first" },
            ]}
            onCommit={(routingAxis) =>
              props.write({ ...props.semantic, routingAxis })
            }
          />
        </Field>
        <Field label="Bend %">
          <NumberInput
            label="Orthogonal routing bend percentage"
            value={
              typeof props.semantic["routingBend"] === "number"
                ? (props.semantic["routingBend"] as number) * 100
                : 50
            }
            min={0}
            max={100}
            onCommit={(routingBend) =>
              props.write({ ...props.semantic, routingBend: routingBend / 100 })
            }
          />
        </Field>
        <Checkbox
          label="Avoid visible layers"
          checked={props.semantic["routingAvoidObstacles"] !== false}
          onCommit={(routingAvoidObstacles) =>
            props.write({ ...props.semantic, routingAvoidObstacles })
          }
        />
      </Show>
      <Show when={routing() === "manual"}>
        <For each={waypoints()}>
          {(waypoint, index) => (
            <div class="diagra-inspector-stack">
              <strong>Waypoint {index() + 1}</strong>
              <Field label="Along %">
                <NumberInput
                  label={`Waypoint ${index() + 1} position along endpoints`}
                  value={waypoint.u * 100}
                  onCommit={(u) => updateWaypoint(index(), { u: u / 100 })}
                />
              </Field>
              <Field label="Offset">
                <NumberInput
                  label={`Waypoint ${index() + 1} perpendicular offset`}
                  value={waypoint.v}
                  onCommit={(v) => updateWaypoint(index(), { v })}
                />
              </Field>
              <div class="diagra-inspector-actions">
                <button
                  type="button"
                  disabled={index() === 0}
                  onClick={() => moveWaypoint(index(), -1)}
                >
                  Earlier
                </button>
                <button
                  type="button"
                  disabled={index() === waypoints().length - 1}
                  onClick={() => moveWaypoint(index(), 1)}
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={() =>
                    writeWaypoints(
                      waypoints().filter((_, at) => at !== index()),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </For>
        <button
          type="button"
          disabled={waypoints().length >= MAX_CONNECTOR_WAYPOINTS}
          onClick={() => {
            const count = waypoints().length;
            writeWaypoints([
              ...waypoints(),
              {
                u: (count + 1) / (count + 2),
                v: count % 2 === 0 ? 40 : -40,
              },
            ]);
          }}
        >
          Add waypoint
        </button>
      </Show>
    </>
  );
}

export default ConnectorRoutingFields;
