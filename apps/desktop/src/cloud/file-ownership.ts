import type { DocumentSession } from "../file/session.ts";
import type { CloudSession } from "./session.ts";

/**
 * Transfer editor ownership synchronously, before a room applies its snapshot.
 * A reactive UI effect runs too late to protect local autosave from that write.
 * Transport reconnects and replacement viewer documents retain cloud ownership.
 */
export function bindCloudFileOwnership(
  cloud: Pick<CloudSession, "state" | "subscribe">,
  files: Pick<DocumentSession, "suspend" | "resume">,
): () => void {
  let owned: boolean | undefined;
  const update = (state: ReturnType<CloudSession["state"]>): void => {
    if (owned === state.ownsEditor) return;
    owned = state.ownsEditor;
    if (owned) files.suspend();
    else files.resume();
  };
  const stop = cloud.subscribe(update);
  update(cloud.state());
  return stop;
}
