#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createNanny } from "./api.js";
import { Config } from "./pkg/config.js";
import { NannyError } from "./pkg/errors.js";

function printUsage(): void {
  process.stdout.write(
    `nanny — Dependency-aware process manager

Usage:
  nanny [options]
  nanny --root <path> [options]
  nanny config init

Options:
  --root <path>   Path to the api project root (defaults to cwd if nanny.json exists)
  --group <name>  Only start services in the named group
  --dry-run       Print dependency map without starting services
  --help, -h      Show this help

Commands:
  config init     Generate a base nanny.json in the current directory

Examples:
  nanny --root project/path
  nanny                                # uses cwd if nanny.json exists
  nanny --root project/path --dry-run
  nanny --root project/path --group auth
  nanny config init
`,
  );
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (args[0] === "config" && args[1] === "init") {
  Config.init(process.cwd());
  process.exit(0);
}

const rootIndex = args.indexOf("--root");
let rootDir: string;

if (rootIndex !== -1 && rootIndex < args.length - 1) {
  rootDir = args[rootIndex + 1];
} else {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "nanny.json");
  if (fs.existsSync(configPath)) {
    rootDir = cwd;
  } else {
    console.error(
      "error: no nanny.json found in current directory\n  Specify --root <path> or run `nanny config init`",
    );
    process.exit(1);
  }
}
const dryRun = args.includes("--dry-run");

const groupIndex = args.indexOf("--group");
const group =
  groupIndex !== -1 && groupIndex < args.length - 1
    ? args[groupIndex + 1]
    : undefined;

try {
  const nanny = createNanny({ rootDir, dryRun, group });
  nanny.start();
} catch (err) {
  const message = err instanceof NannyError
    ? err.message
    : `unexpected error: ${(err as Error).message}`;
  console.error(`[nanny] error: ${message}`);
  process.exit(1);
}
