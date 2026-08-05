import { describe, expect, it } from "vitest";
import { classifyConflict } from "../src/conflict.js";

describe("classifyConflict", () => {
  it("is unverified when the remote copy could not be read", () => {
    expect(classifyConflict({ localHash: "a", remoteUnavailable: true })).toMatchObject({ status: "unverified" });
  });

  it("is safe when the file does not exist on HubSpot yet", () => {
    expect(classifyConflict({ localHash: "a" })).toMatchObject({ status: "safe", reason: "not on HubSpot yet" });
  });

  it("is identical when remote already matches local", () => {
    expect(classifyConflict({ localHash: "a", remoteHash: "a", syncedHash: "b" })).toMatchObject({
      status: "identical",
    });
  });

  it("is unverified when there is no sync record to compare against", () => {
    expect(classifyConflict({ localHash: "a", remoteHash: "b" })).toMatchObject({ status: "unverified" });
  });

  it("is safe when the remote is unchanged since the last sync", () => {
    expect(classifyConflict({ localHash: "local", remoteHash: "synced", syncedHash: "synced" })).toMatchObject({
      status: "safe",
    });
  });

  it("is a conflict when the remote moved away from the last sync", () => {
    expect(classifyConflict({ localHash: "local", remoteHash: "edited-in-ui", syncedHash: "synced" })).toMatchObject({
      status: "conflict",
      reason: "remote changed since last sync",
    });
  });
});
