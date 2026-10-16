import { lazy, Suspense, type JSX } from "solid-js";
import type { ExportDialogProps } from "./ExportDialog.tsx";
const Dialog = lazy(() =>
  import("./ExportDialog.tsx").then((m) => ({ default: m.ExportDialog })),
);
export function ExportDialog(props: ExportDialogProps): JSX.Element {
  return (
    <Suspense>
      <Dialog {...props} />
    </Suspense>
  );
}
