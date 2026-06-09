import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const entry = path.join(projectRoot, "src/index.ts");

function run(args: string[]) {
  return spawnSync("node", ["--import", "tsx", entry, ...args], {
    cwd: projectRoot,
    encoding: "utf-8",
  });
}

function runInDir(dir: string, args: string[]) {
  return spawnSync("node", ["--import", "tsx", entry, ...args], {
    cwd: dir,
    encoding: "utf-8",
  });
}

const tmpBase = fs.mkdtempSync("nanny-cli-test-");

describe("CLI --help", () => {
  it("prints usage with --help", () => {
    const result = run(["--help"]);
    assert.equal(result.status, 0);
    assert(result.stdout.includes("Usage"));
  });

  it("prints usage with -h", () => {
    const result = run(["-h"]);
    assert.equal(result.status, 0);
    assert(result.stdout.includes("Usage"));
  });
});

describe("CLI config init", () => {
  const tmpDir = path.join(tmpBase, "config-init");

  before(() => fs.mkdirSync(tmpDir, { recursive: true }));
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("creates a nanny.json", () => {
    const result = runInDir(tmpDir, ["config", "init"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert(fs.existsSync(path.join(tmpDir, "nanny.json")));
    assert(result.stdout.includes("created config"));
  });

  it("skips if nanny.json already exists", () => {
    const result = runInDir(tmpDir, ["config", "init"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert(result.stdout.includes("already exists"));
  });
});

describe("CLI --root auto-detect", () => {
  const tmpDir = path.join(tmpBase, "auto-root");

  it("uses cwd when nanny.json exists there and no --root given", () => {
    fs.mkdirSync(path.join(tmpDir, "pkg", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "pkg", "common", "index.ts"),
      "export const x = 1;",
    );
    fs.writeFileSync(
      path.join(tmpDir, "services", "auth", "app.ts"),
      `import { x } from "../../pkg/common/index.js";\nconsole.log(x);`,
    );
    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "esnext", module: "nodenext", strict: true } }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: { include_dir: ["pkg", "services"], exclude_dir: [], include_files: [], exclude_files: [] },
        service_groups: {},
        services: { auth: { entrypoint: "services/auth/app.ts" } },
      }),
    );
    const result = runInDir(tmpDir, ["--dry-run"]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("errors when no --root and no nanny.json in cwd", () => {
    const emptyDir = path.join(tmpBase, "no-root-no-config");
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = runInDir(emptyDir, []);
    assert.equal(result.status, 1);
    assert(result.stderr.includes("no nanny.json found"));
    assert(result.stderr.includes("nanny config init"));
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("CLI errors", () => {
  it("exits with error for missing root directory", () => {
    const result = run(["--root", "/nonexistent-path-12345"]);
    assert.equal(result.status, 1);
    assert(result.stderr.includes("root directory not found"));
  });

  it("exits with error for missing config", () => {
    const emptyDir = path.join(tmpBase, "empty-root");
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = run(["--root", emptyDir]);
    assert.equal(result.status, 1);
    assert(result.stderr.includes("config file not found"));
    assert(result.stderr.includes("nanny config init"));
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));
