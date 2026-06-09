import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Scanner } from "./scanner.js";
import { Config } from "./config.js";
import { Logger } from "./logger.js";

const tmpBase = fs.mkdtempSync("nanny-scanner-test-");

after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

describe("Scanner", () => {
  const tmpDir = path.join(tmpBase, "basic");
  let depMap: ReturnType<Scanner["build"]>;

  before(() => {
    fs.mkdirSync(path.join(tmpDir, "pkg", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "pkg", "utils"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "auth"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "users"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "pkg", "common", "index.ts"),
      "export const greet = () => 'hello';",
    );
    fs.writeFileSync(
      path.join(tmpDir, "pkg", "utils", "index.ts"),
      "export const add = (a: number, b: number) => a + b;",
    );

    fs.writeFileSync(
      path.join(tmpDir, "services", "auth", "app.ts"),
      `import { greet } from "../../pkg/common/index.js";\ngreet();`,
    );
    fs.writeFileSync(
      path.join(tmpDir, "services", "users", "app.ts"),
      `import { add } from "../../pkg/utils/index.js";\nadd(1, 2);`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          strict: true,
        },
      }),
    );

    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: {
          include_dir: ["pkg", "services"],
          exclude_dir: [],
          include_files: [],
          exclude_files: [],
        },
        service_groups: {},
        services: {
          auth: { entrypoint: "services/auth/app.ts" },
          users: { entrypoint: "services/users/app.ts" },
        },
      }),
    );
  });

  it("builds a dependency map from imports", () => {
    const logger = new Logger();
    const config = new Config(tmpDir, logger);
    const scanner = new Scanner(tmpDir, config.getConfig(), logger);
    depMap = scanner.build();

    assert(depMap.sharedToServices instanceof Map);
    assert(depMap.serviceDeps instanceof Map);
    assert(depMap.svcToServices instanceof Map);
    assert(depMap.serviceRoots instanceof Map);
  });

  it("sharedToServices maps shared groups to services that depend on them", () => {
    const authSvcs = depMap.sharedToServices.get("common");
    assert(authSvcs);
    assert(authSvcs.has("auth"));
    assert(!authSvcs.has("users"));

    const usersSvcs = depMap.sharedToServices.get("utils");
    assert(usersSvcs);
    assert(usersSvcs.has("users"));
    assert(!usersSvcs.has("auth"));
  });

  it("serviceDeps maps services to shared groups they depend on", () => {
    const authDeps = depMap.serviceDeps.get("auth");
    assert(authDeps);
    assert(authDeps.has("common"));

    const usersDeps = depMap.serviceDeps.get("users");
    assert(usersDeps);
    assert(usersDeps.has("utils"));
  });

  it("svcToServices is initially empty when no cross-service deps", () => {
    assert(depMap.svcToServices.has("auth"));
    assert(depMap.svcToServices.has("users"));
    assert.equal(depMap.svcToServices.get("auth")!.size, 0);
    assert.equal(depMap.svcToServices.get("users")!.size, 0);
  });

  it("serviceRoots contains entries for each service", () => {
    assert.equal(depMap.serviceRoots.get("auth"), "services/auth");
    assert.equal(depMap.serviceRoots.get("users"), "services/users");
  });
});

describe("Scanner cross-service dependencies", () => {
  const tmpDir = path.join(tmpBase, "cross-svc");
  let depMap: ReturnType<Scanner["build"]>;

  before(() => {
    fs.mkdirSync(path.join(tmpDir, "pkg", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "auth"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "users"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "services", "cases"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "pkg", "common", "index.ts"),
      "export const shared = true;",
    );

    fs.writeFileSync(
      path.join(tmpDir, "services", "auth", "app.ts"),
      "export const authUrl = '/auth';",
    );

    fs.writeFileSync(
      path.join(tmpDir, "services", "users", "app.ts"),
      `import { authUrl } from "../auth/app.js";\nexport const getUsers = () => authUrl;`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "services", "cases", "app.ts"),
      `import { getUsers } from "../users/app.js";\nconsole.log(getUsers());`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          strict: true,
        },
      }),
    );

    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: {
          include_dir: ["pkg", "services"],
          exclude_dir: [],
          include_files: [],
          exclude_files: [],
        },
        service_groups: {},
        services: {
          auth: { entrypoint: "services/auth/app.ts" },
          users: { entrypoint: "services/users/app.ts" },
          cases: { entrypoint: "services/cases/app.ts" },
        },
      }),
    );
  });

  it("detects direct cross-service dependencies", () => {
    const logger = new Logger();
    const config = new Config(tmpDir, logger);
    const scanner = new Scanner(tmpDir, config.getConfig(), logger);
    depMap = scanner.build();

    assert(
      depMap.svcToServices.get("auth")!.has("users"),
      "users should depend on auth",
    );
  });

  it("detects transitive cross-service dependencies", () => {
    assert(
      depMap.svcToServices.get("auth")!.has("cases"),
      "cases should transitively depend on auth",
    );
  });

  it("does not mark a service as depending on itself", () => {
    assert(!depMap.svcToServices.get("auth")!.has("auth"));
    assert(!depMap.svcToServices.get("users")!.has("users"));
    assert(!depMap.svcToServices.get("cases")!.has("cases"));
  });

  it("serviceRoots map contains correct directories", () => {
    assert.equal(depMap.serviceRoots.get("auth"), "services/auth");
    assert.equal(depMap.serviceRoots.get("users"), "services/users");
    assert.equal(depMap.serviceRoots.get("cases"), "services/cases");
  });
});

describe("Scanner flexible structure", () => {
  const tmpDir = path.join(tmpBase, "flexible");
  let depMap: ReturnType<Scanner["build"]>;

  before(() => {
    fs.mkdirSync(path.join(tmpDir, "lib", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "apps", "auth"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "lib", "common", "helpers.ts"),
      "export const help = () => true;",
    );

    fs.writeFileSync(
      path.join(tmpDir, "apps", "auth", "server.ts"),
      `import { help } from "../../lib/common/helpers.js";\nhelp();`,
    );

    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          strict: true,
        },
      }),
    );

    fs.writeFileSync(
      path.join(tmpDir, "nanny.json"),
      JSON.stringify({
        watcher: {
          include_dir: ["lib", "apps"],
          exclude_dir: [],
          include_files: [],
          exclude_files: [],
        },
        service_groups: {},
        services: {
          auth: { entrypoint: "apps/auth/server.ts" },
        },
      }),
    );
  });

  it("works with non-standard directory structures", () => {
    const logger = new Logger();
    const config = new Config(tmpDir, logger);
    const scanner = new Scanner(tmpDir, config.getConfig(), logger);
    depMap = scanner.build();

    assert(depMap.serviceRoots.get("auth"), "apps/auth");
    assert(depMap.sharedToServices.get("common")?.has("auth"));
    assert(depMap.serviceDeps.get("auth")?.has("common"));
  });
});
