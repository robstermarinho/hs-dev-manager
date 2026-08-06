import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RemoteCheckModule from "../src/actions/remote-check.js";

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

import { deployAction } from "../src/actions/deploy.js";
import type { RemoteConflict } from "../src/actions/remote-check.js";
import type { HsAccount } from "../src/hs/accounts.js";
import { loadHistory } from "../src/state/history.js";
import { loadRemoteState, sha256, syncedHash } from "../src/state/remote-state.js";

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

beforeEach(() => {
  vi.clearAllMocks();
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
