import type { JSX } from "solid-js";
import { lazy, Suspense } from "solid-js";
import type { InspectorProps } from "./Inspector.tsx";

const InspectorPanel = lazy(() =>
  import("./Inspector.tsx").then((module) => ({ default: module.Inspector })),
);

/** Keep property editors and developer exporters out of initial application JS. */
export function Inspector(props: InspectorProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <aside class="nodetto-inspector" aria-label="Properties">
          <p class="nodetto-inspector-summary">Loading properties…</p>
        </aside>
      }
    >
      <InspectorPanel {...props} />
    </Suspense>
  );
}
