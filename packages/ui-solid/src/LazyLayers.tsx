import type { Editor, ViewportSize } from "@diagra/core";
import { type JSX, lazy, Suspense } from "solid-js";

const LayersPanel = lazy(() =>
  import("./Layers.tsx").then((module) => ({ default: module.Layers })),
);

/** Keep design-system libraries and layer-tree controls out of initial JS. */
export function Layers(props: {
  readonly editor: Editor;
  readonly viewport?: ViewportSize;
  readonly commentAuthor?: string;
  readonly commentPlacementActive?: boolean;
  readonly onPlaceComment?: (
    input: {
      readonly author: string;
      readonly body: string;
    },
    onPlaced: () => void,
  ) => void;
  readonly onCancelCommentPlacement?: () => void;
}): JSX.Element {
  return (
    <Suspense
      fallback={
        <nav class="diagra-layers" aria-label="Layers">
          <h2>Layers</h2>
        </nav>
      }
    >
      <LayersPanel {...props} />
    </Suspense>
  );
}
