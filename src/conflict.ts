/**
 * Remote conflict detection for uploads.
 *
 * `hs cms upload` overwrites the Design Manager copy unconditionally, so an edit
 * made in the HubSpot UI is lost silently. HubSpot's CLI exposes no modification
 * timestamps (`hs cms list` prints bare names), so divergence is detected by
 * content: the hash of the remote copy is compared against the hash recorded the
 * last time this tool synced that file (see `state/remote-state.ts`).
 */

export type ConflictStatus = "safe" | "identical" | "conflict" | "unverified";

export interface ConflictCheck {
  status: ConflictStatus;
  reason: string;
}

export interface ConflictInput {
  /** Hash of the local file about to be uploaded. */
  localHash: string;
  /** Hash of the current remote copy; undefined when the file is not on HubSpot yet. */
  remoteHash?: string;
  /** Hash recorded on the last fetch/deploy of this file. */
  syncedHash?: string;
  /** The remote copy could not be read (listing or download failed). */
  remoteUnavailable?: boolean;
}

export function classifyConflict(input: ConflictInput): ConflictCheck {
  if (input.remoteUnavailable) {
    return { status: "unverified", reason: "remote copy could not be read" };
  }
  if (input.remoteHash === undefined) {
    return { status: "safe", reason: "not on HubSpot yet" };
  }
  if (input.remoteHash === input.localHash) {
    return { status: "identical", reason: "remote already matches local" };
  }
  if (input.syncedHash === undefined) {
    return { status: "unverified", reason: "no sync record — remote content never seen by this tool" };
  }
  if (input.remoteHash === input.syncedHash) {
    return { status: "safe", reason: "remote unchanged since last sync" };
  }
  return { status: "conflict", reason: "remote changed since last sync" };
}
