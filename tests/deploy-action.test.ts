import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RemoteCheckModule from "../src/actions/remote-check.js";
import type * as RemoteDeleteModule from "../src/actions/remote-delete.js";

const mocks = vi.hoisted(() => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  upload: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  note: vi.fn(),
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  spinnerMessage: vi.fn(),
  checkRemoteConflicts: vi.fn(),
  checkRemoteDeletions: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  multiselect: mocks.multiselect,
  select: mocks.select,
  text: mocks.text,
  confirm: mocks.confirm,
  isCancel: () => false,
  note: mocks.note,
  spinner: () => ({ start: mocks.spinnerStart, stop: mocks.spinnerStop, message: mocks.spinnerMessage }),
  log: {
    warn: mocks.warn,
    error: mocks.error,
    info: mocks.info,
    success: mocks.success,
  },
}));

vi.mock("../src/hs/runner.js", () => ({ runHs: mocks.upload }));

vi.mock("../src/actions/remote-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteCheckModule>();
  return { ...actual, checkRemoteConflicts: mocks.checkRemoteConflicts };
});

vi.mock("../src/actions/remote-delete.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteDeleteModule>();
  return { ...actual, checkRemoteDeletions: mocks.checkRemoteDeletions };
});

import { defaultDeployMessage, deployAction } from "../src/actions/deploy.js";
import type { RemoteConflict } from "../src/actions/remote-check.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { loadHistory } from "../src/state/history.js";
import {
  loadRemoteState,
  recordRemoteFiles,
  saveRemoteState,
  sha256,
  syncedHash,
} from "../src/state/remote-state.js";

const account: HsAccount = { name: "example", accountId: "123456", isDefault: true };

function safeChecks(files: string[]): RemoteConflict[] {
  return files.map((file) => ({
    file,
    remotePath: file.replace("src/example-123456", ""),
    check: { status: "safe", reason: "remote unchanged since last sync" },
  }));
}

async function createRepo(): Promise<{ cwd: string; first: string; second: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "hsdm-deploy-"));
  const root = join(cwd, "src", "example-123456", "theme");
  const first = join(root, "first.css");
  const second = join(root, "second.css");
  await mkdir(root, { recursive: true });
  await writeFile(first, "before", "utf8");
  await writeFile(second, "before", "utf8");
  await execa("git", ["init", "--quiet"], { cwd });
  await execa("git", ["config", "user.name", "Test"], { cwd });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd });
  await execa("git", ["add", "."], { cwd });
  await execa("git", ["commit", "-m", "base", "--quiet"], { cwd });
  await writeFile(first, "uploaded", "utf8");
  await writeFile(second, "failed", "utf8");
  return { cwd, first, second };
}

const SECOND = "src/example-123456/theme/second.css";
const OK = { ok: true, exitCode: 0, stdout: "", stderr: "" };

/** `hs` stub: uploads succeed, deletes answer with the given output. */
function hsStub(deleteOutput: string = 'Deleted "/theme/second.css" from account 123456') {
  return async (args: string[]) => (args[1] === "delete" ? { ...OK, stdout: deleteOutput } : OK);
}

function deleteCalls(): unknown[][] {
  return mocks.upload.mock.calls.filter(([args]) => (args as string[])[1] === "delete");
}

function deletionCheck(status: "safe" | "changed" | "gone" | "unverified") {
  return [{ file: SECOND, remotePath: "/theme/second.css", status, reason: `test: ${status}` }];
}

async function scopeStatus(cwd: string): Promise<string> {
  return (await execa("git", ["status", "--short", "--", "src"], { cwd })).stdout;
}

/** A repo where `first.css` is edited and `second.css` was deleted locally. */
async function createRepoWithDeletion(): Promise<{ cwd: string; first: string }> {
  const { cwd, first, second } = await createRepo();
  await rm(second);
  return { cwd, first };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRemoteDeletions.mockResolvedValue(deletionCheck("safe"));
  mocks.text.mockResolvedValue("feat(hubspot): deploy selected files");
  mocks.confirm.mockResolvedValue(true);
  mocks.checkRemoteConflicts.mockImplementation(async (_account, files: string[]) => safeChecks(files));
});

describe("deployAction", () => {
  it("commits only successful uploads and records a partial deploy", async () => {
    const { cwd, first, second } = await createRepo();
    const selected = [
      "src/example-123456/theme/first.css",
      "src/example-123456/theme/second.css",
    ];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.upload
      .mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: "", stderr: "upload failed" });

    await deployAction(account, cwd);

    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      ["cms", "upload", first, "/theme/first.css"],
      { accountId: "123456", cwd }
    );
    expect(mocks.upload).toHaveBeenNthCalledWith(
      2,
      ["cms", "upload", second, "/theme/second.css"],
      { accountId: "123456", cwd }
    );
    expect((await execa("git", ["show", "HEAD:src/example-123456/theme/first.css"], { cwd })).stdout).toBe(
      "uploaded"
    );
    expect((await readFile(second, "utf8"))).toBe("failed");
    expect((await execa("git", ["status", "--short"], { cwd })).stdout).toContain("second.css");

    const history = await loadHistory(cwd);
    expect(history.deploys[0]).toMatchObject({ status: "partial", file_count: 1, files: [selected[0]] });

    // Only the uploaded file becomes the new sync baseline.
    const remoteState = await loadRemoteState(cwd);
    expect(syncedHash(remoteState, "example-123456", "/theme/first.css")).toBe(sha256("uploaded"));
    expect(syncedHash(remoteState, "example-123456", "/theme/second.css")).toBeUndefined();
  });

  it("skips files the remote changed and uploads the rest", async () => {
    const { cwd, first } = await createRepo();
    const selected = ["src/example-123456/theme/first.css", "src/example-123456/theme/second.css"];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.checkRemoteConflicts.mockResolvedValue([
      ...safeChecks([selected[0] as string]),
      {
        file: selected[1] as string,
        remotePath: "/theme/second.css",
        check: { status: "conflict", reason: "remote changed since last sync" },
      },
    ]);
    mocks.select.mockResolvedValue("skip");
    mocks.upload.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });

    await deployAction(account, cwd);

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledWith(["cms", "upload", first, "/theme/first.css"], {
      accountId: "123456",
      cwd,
    });
    const history = await loadHistory(cwd);
    expect(history.deploys[0]).toMatchObject({ status: "success", file_count: 1, files: [selected[0]] });
  });

  it("skips files that fail lint before touching the network", async () => {
    const { cwd } = await createRepo();
    const broken = join(cwd, "src", "example-123456", "theme", "broken.html");
    const good = join(cwd, "src", "example-123456", "theme", "good.html");
    await writeFile(broken, "{% for item in items %}\n<p>{{ item }}</p>\n", "utf8");
    await writeFile(good, "{% for item in items %}{{ item }}{% endfor %}\n", "utf8");
    const selected = ["src/example-123456/theme/broken.html", "src/example-123456/theme/good.html"];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.select.mockResolvedValue("skip");
    mocks.upload.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });

    await deployAction(account, cwd);

    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("{% for %} is never closed"));
    expect(mocks.checkRemoteConflicts).toHaveBeenCalledWith(
      account,
      ["src/example-123456/theme/good.html"],
      cwd,
      expect.anything()
    );
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledWith(["cms", "upload", good, "/theme/good.html"], {
      accountId: "123456",
      cwd,
    });
  });

  it("aborts the deploy when the user cancels on lint errors", async () => {
    const { cwd } = await createRepo();
    const broken = join(cwd, "src", "example-123456", "theme", "broken.html");
    await writeFile(broken, "{% if a %}\n", "utf8");
    mocks.multiselect.mockResolvedValue(["src/example-123456/theme/broken.html"]);
    mocks.select.mockResolvedValue("cancel");

    await deployAction(account, cwd);

    expect(mocks.checkRemoteConflicts).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("shows the HubSpot → local diff and returns to the conflict prompt", async () => {
    const { cwd } = await createRepo();
    const selected = ["src/example-123456/theme/first.css"];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.checkRemoteConflicts.mockResolvedValue([
      {
        file: selected[0] as string,
        remotePath: "/theme/first.css",
        check: { status: "conflict", reason: "remote changed since last sync" },
        remoteContent: Buffer.from("edited in the HubSpot UI"),
      },
    ]);
    mocks.select.mockResolvedValueOnce("diff").mockResolvedValueOnce("overwrite");
    mocks.upload.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });

    await deployAction(account, cwd);

    const diffNote = mocks.note.mock.calls.find(([, title]) => String(title).includes("hubspot → local"));
    expect(diffNote?.[0]).toContain("edited in the HubSpot UI");
    expect(diffNote?.[0]).toContain("uploaded");
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("uploads without checking HubSpot when the environment opts out", async () => {
    const { cwd, first } = await createRepo();
    process.env.HSDM_NO_REMOTE_CHECK = "1";
    mocks.multiselect.mockResolvedValue(["src/example-123456/theme/first.css"]);
    mocks.upload.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });

    try {
      await deployAction(account, cwd);
    } finally {
      delete process.env.HSDM_NO_REMOTE_CHECK;
    }

    expect(mocks.checkRemoteConflicts).not.toHaveBeenCalled();
    // The lost protection has to be said out loud, not assumed.
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("HSDM_NO_REMOTE_CHECK"));
    expect(mocks.upload).toHaveBeenCalledWith(["cms", "upload", first, "/theme/first.css"], {
      accountId: "123456",
      cwd,
    });
  });

  it("aborts without uploading when the user cancels on a conflict", async () => {
    const { cwd } = await createRepo();
    const selected = ["src/example-123456/theme/first.css"];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.checkRemoteConflicts.mockResolvedValue([
      {
        file: selected[0] as string,
        remotePath: "/theme/first.css",
        check: { status: "conflict", reason: "remote changed since last sync" },
      },
    ]);
    mocks.select.mockResolvedValue("cancel");

    await deployAction(account, cwd);

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.text).not.toHaveBeenCalled();
  });

  it("uploads a conflicted file when the user chooses to overwrite", async () => {
    const { cwd } = await createRepo();
    const selected = ["src/example-123456/theme/first.css"];
    mocks.multiselect.mockResolvedValue(selected);
    mocks.checkRemoteConflicts.mockResolvedValue([
      {
        file: selected[0] as string,
        remotePath: "/theme/first.css",
        check: { status: "conflict", reason: "remote changed since last sync" },
      },
    ]);
    mocks.select.mockResolvedValue("overwrite");
    mocks.upload.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "" });

    await deployAction(account, cwd);

    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
});

describe("deployAction — files deleted locally", () => {
  it("deletes the picked files on HubSpot and commits the deletion with the uploads", async () => {
    const { cwd, first } = await createRepoWithDeletion();
    await saveRemoteState(
      recordRemoteFiles({ files: {} }, "example-123456", [
        { remotePath: "/theme/second.css", sha256: sha256("before") },
      ]),
      cwd
    );
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.upload.mockImplementation(hsStub());

    await deployAction(account, cwd);

    expect(mocks.upload).toHaveBeenCalledWith(["cms", "upload", first, "/theme/first.css"], {
      accountId: "123456",
      cwd,
    });
    expect(deleteCalls()).toEqual([[["cms", "delete", "/theme/second.css"], { accountId: "123456" }]]);
    // Nothing is deleted without a confirmation that defaults to "no".
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Permanently delete 1 file(s)"), initialValue: false })
    );

    expect(await scopeStatus(cwd)).toBe("");
    const tracked = await execa("git", ["ls-files", "--", "src"], { cwd });
    expect(tracked.stdout).not.toContain("second.css");

    const history = await loadHistory(cwd);
    expect(history.deploys[0]).toMatchObject({
      status: "success",
      file_count: 1,
      files: ["src/example-123456/theme/first.css"],
      deleted_files: [SECOND],
    });
    // The deleted file has no remote copy left to compare against.
    expect(syncedHash(await loadRemoteState(cwd), "example-123456", "/theme/second.css")).toBeUndefined();
  });

  it("selects nothing by default and leaves unpicked files on HubSpot", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([]);
    mocks.upload.mockImplementation(hsStub());

    await deployAction(account, cwd);

    expect(mocks.multiselect).toHaveBeenCalledWith(expect.objectContaining({ initialValues: [], required: false }));
    expect(mocks.checkRemoteDeletions).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(0);
    // The upload still goes out; the deletion stays in the tree, uncommitted.
    expect(await scopeStatus(cwd)).toContain("second.css");
    expect((await loadHistory(cwd)).deploys[0]).not.toHaveProperty("deleted_files");
  });

  it("deletes nothing when the confirmation is declined", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.confirm.mockImplementation(async ({ message }: { message: string }) => !message.startsWith("Permanently"));
    mocks.upload.mockImplementation(hsStub());

    await deployAction(account, cwd);

    expect(deleteCalls()).toHaveLength(0);
    expect(await scopeStatus(cwd)).toContain("second.css");
  });

  it("keeps a file that changed on HubSpot when the user chooses to keep it", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.checkRemoteDeletions.mockResolvedValue(deletionCheck("changed"));
    mocks.select.mockResolvedValue("skip");
    mocks.upload.mockImplementation(hsStub());

    await deployAction(account, cwd);

    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("may lose edits made on HubSpot"));
    expect(deleteCalls()).toHaveLength(0);
    expect(await scopeStatus(cwd)).toContain("second.css");
  });

  it("deletes a file that changed on HubSpot only when told to", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.checkRemoteDeletions.mockResolvedValue(deletionCheck("unverified"));
    mocks.select.mockResolvedValue("delete");
    mocks.upload.mockImplementation(hsStub());

    await deployAction(account, cwd);

    expect(deleteCalls()).toHaveLength(1);
    expect(await scopeStatus(cwd)).toBe("");
  });

  it("does not commit a deletion hs reported as failed, even with exit code 0", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.upload.mockImplementation(hsStub('Deleting "/theme/second.css" from account 123456 failed'));

    await deployAction(account, cwd);

    expect(await scopeStatus(cwd)).toContain("second.css");
    const history = await loadHistory(cwd);
    expect(history.deploys[0]).toMatchObject({ status: "partial", file_count: 1 });
    expect(history.deploys[0]).not.toHaveProperty("deleted_files");
  });

  it("commits a deletion HubSpot already has, without calling hs or asking to confirm", async () => {
    const { cwd, first } = await createRepoWithDeletion();
    await writeFile(first, "before", "utf8"); // delete-only deploy
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.checkRemoteDeletions.mockResolvedValue(deletionCheck("gone"));

    await deployAction(account, cwd);

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.text).toHaveBeenCalledWith(
      expect.objectContaining({ initialValue: "feat(hubspot): delete 1 file(s) on example" })
    );
    expect(await scopeStatus(cwd)).toBe("");
    expect((await loadHistory(cwd)).deploys[0]).toMatchObject({ file_count: 0, files: [], deleted_files: [SECOND] });
  });

  it("deletes nothing when every upload failed", async () => {
    const { cwd } = await createRepoWithDeletion();
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.upload.mockResolvedValue({ ok: false, exitCode: 1, stdout: "", stderr: "network down" });

    await deployAction(account, cwd);

    expect(deleteCalls()).toHaveLength(0);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Nothing deleted on HubSpot"));
    expect((await loadHistory(cwd)).deploys).toHaveLength(0);
  });

  it("warns that the comparison was skipped when the environment opts out", async () => {
    const { cwd } = await createRepoWithDeletion();
    process.env.HSDM_NO_REMOTE_CHECK = "1";
    mocks.multiselect.mockResolvedValue([SECOND]);
    mocks.upload.mockImplementation(hsStub());

    try {
      await deployAction(account, cwd);
    } finally {
      delete process.env.HSDM_NO_REMOTE_CHECK;
    }

    expect(mocks.checkRemoteDeletions).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("deleting without comparing against HubSpot"));
    expect(deleteCalls()).toHaveLength(1);
  });
});

describe("defaultDeployMessage", () => {
  it("names what the deploy does", () => {
    expect(defaultDeployMessage(2, 0, "example")).toBe("feat(hubspot): deploy 2 file(s) to example");
    expect(defaultDeployMessage(0, 3, "example")).toBe("feat(hubspot): delete 3 file(s) on example");
    expect(defaultDeployMessage(2, 1, "example")).toBe("feat(hubspot): deploy 2 file(s) to example, delete 1");
  });
});
