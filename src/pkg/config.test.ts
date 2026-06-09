import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Config } from "./config.js";
import { Logger } from "./logger.js";

const tmpBase = fs.mkdtempSync("nanny-config-test-");

describe("Config.init", () => {
  const tmpDir = path.join(tmpBase, "init");

  before(() => fs.mkdirSync(tmpDir, { recursive: true }));
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("creates a valid config file", () => {
    Config.init(tmpDir);
    const configPath = path.join(tmpDir, "nanny.json");
    assert(fs.existsSync(configPath));
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert(parsed.watcher);
    assert(Array.isArray(parsed.watcher.include_dir));
    assert(parsed.services);
    assert(parsed.service_groups);
  });

  it("skips if config already exists", () => {
    Config.init(tmpDir);
    assert(fs.existsSync(path.join(tmpDir, "nanny.json")));
  });
});

describe("Config constructor", () => {
  const tmpDir = path.join(tmpBase, "constructor");

  before(() => fs.mkdirSync(tmpDir, { recursive: true }));
  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("loads a valid config", () => {
    Config.init(tmpDir);
    const logger = new Logger();
    const config = new Config(tmpDir, logger);
    assert(config.getServiceNames());
    assert(config.getConfig());
  });

  it("throws on missing config", () => {
    const empty = path.join(tmpBase, "missing");
    fs.mkdirSync(empty, { recursive: true });
    const logger = new Logger();
    assert.throws(() => new Config(empty, logger), /config file not found/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("throws on invalid JSON", () => {
    const bad = path.join(tmpBase, "invalid-json");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "nanny.json"), "{invalid");
    const logger = new Logger();
    assert.throws(() => new Config(bad, logger), /invalid config file/);
    fs.rmSync(bad, { recursive: true, force: true });
  });

  it("throws when services is missing", () => {
    const bad = path.join(tmpBase, "no-services");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(
      path.join(bad, "nanny.json"),
      JSON.stringify({ watcher: {} }),
    );
    const logger = new Logger();
    assert.throws(() => new Config(bad, logger), /missing "services"/);
    fs.rmSync(bad, { recursive: true, force: true });
  });

  it("throws when watcher is missing", () => {
    const bad = path.join(tmpBase, "no-watcher");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(
      path.join(bad, "nanny.json"),
      JSON.stringify({ services: {} }),
    );
    const logger = new Logger();
    assert.throws(() => new Config(bad, logger), /missing "watcher"/);
    fs.rmSync(bad, { recursive: true, force: true });
  });
});

describe("Config getters", () => {
  const tmpDir = path.join(tmpBase, "getters");
  let config: Config;

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: {
          include_dir: ["pkg"],
          exclude_dir: [],
          include_files: [],
          exclude_files: [],
        },
        service_groups: {
          api: ["auth", "users"],
        },
        services: {
          auth: { entrypoint: "services/auth/app.ts" },
          users: { entrypoint: "services/users/app.ts" },
        },
      }),
    );
    config = new Config(tmpDir, new Logger());
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("getServiceNames returns all service names", () => {
    assert.deepEqual(config.getServiceNames(), ["auth", "users"]);
  });

  it("getServices returns the raw services map", () => {
    const services = config.getServices();
    assert(services.auth);
    assert.equal(services.auth.entrypoint, "services/auth/app.ts");
  });

  it("getServiceGroup returns services in a named group", () => {
    assert.deepEqual(config.getServiceGroup("api"), ["auth", "users"]);
  });

  it("getServiceGroup throws on unknown group", () => {
    assert.throws(() => config.getServiceGroup("nonexistent"), /unknown service group/);
  });

  it("getServiceGroups returns all groups", () => {
    const groups = config.getServiceGroups();
    assert.deepEqual(groups.api, ["auth", "users"]);
  });

  it("getEntrypoint returns the entrypoint for a service", () => {
    assert.equal(config.getEntrypoint("auth"), "services/auth/app.ts");
  });

  it("getEntrypoint throws on unknown service", () => {
    assert.throws(() => config.getEntrypoint("nonexistent"), /unknown service/);
  });

  it("hasService returns true for existing services", () => {
    assert.equal(config.hasService("auth"), true);
    assert.equal(config.hasService("users"), true);
    assert.equal(config.hasService("nonexistent"), false);
  });

  it("getWatcherConfig returns the watcher config", () => {
    const wc = config.getWatcherConfig();
    assert.deepEqual(wc.include_dir, ["pkg"]);
  });

  it("getConfig returns the full config object", () => {
    const cfg = config.getConfig();
    assert(cfg.watcher);
    assert(cfg.services);
    assert(cfg.service_groups);
  });
});

describe("Config warnings", () => {
  const tmpDir = path.join(tmpBase, "warnings");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: { include_dir: [], exclude_dir: [], include_files: [], exclude_files: [] },
        service_groups: {
          broken: ["nonexistent-service"],
        },
        services: {},
      }),
    );
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("warns when a group references a missing service", () => {
    const logger = new Logger();
    const config = new Config(tmpDir, logger);
    assert.deepEqual(config.getServiceNames(), []);
  });
});

describe("Config service_groups fallback", () => {
  const tmpDir = path.join(tmpBase, "fallback");
  let config: Config;

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: {
          include_dir: [],
          exclude_dir: [],
          include_files: [],
          exclude_files: [],
        },
        services: {},
      }),
    );
    config = new Config(tmpDir, new Logger());
  });

  after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("getServiceGroups returns empty object when no groups defined", () => {
    assert.deepEqual(config.getServiceGroups(), {});
  });
});

after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));
