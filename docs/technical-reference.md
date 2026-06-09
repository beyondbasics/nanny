# Nanny — Technical Reference

## 1. Overview

Nanny is a dependency-aware process manager for Node.js microservice architectures and monorepos. It selectively restarts only the services affected by a file change, eliminating the need to kill and restart entire application fleets during development. The system operates as a long-lived daemon that watches a project's file system, maintains a dependency graph derived from static import analysis, and maps file change events to the minimal set of child processes that require restart.

The project is written entirely in TypeScript (ESM) and targets the Node.js runtime. It exposes both a command-line interface (`nanny`) and a programmatic API (`createNanny`).

---

## 2. Project Structure

```
src/
├── api.ts              # Public API factory: createNanny()
├── index.ts            # CLI entry point (bin target)
├── index.test.ts       # CLI integration tests
└── pkg/
    ├── config.ts       # Configuration loader and validator
    ├── config.test.ts  # Config unit tests
    ├── logger.ts       # Simple structured logger
    ├── restarter.ts    # Child process lifecycle management
    ├── scanner.ts      # Dependency graph builder (dscan)
    ├── scanner.test.ts # Scanner unit tests
    ├── types.ts        # Shared type definitions
    └── watcher.ts      # File system watcher (chokidar)
```

---

## 3. Type System

All core interfaces are defined in `src/pkg/types.ts`.

### 3.1 NannyConfig

```typescript
interface NannyConfig {
  watcher: WatcherConfig;
  service_groups: Record<string, string[]>;
  services: Record<string, ServiceConfig>;
}
```

Represents the serialised shape of `nanny.json`. The `services` map is the canonical registry of all managed processes. The `service_groups` map provides named subsets for targeted development sessions.

### 3.2 WatcherConfig

```typescript
interface WatcherConfig {
  include_dir: string[];
  exclude_dir: string[];
  include_files: string[];
  exclude_files: string[];
}
```

Controls the file system surveillance scope. `include_dir` specifies which directories (relative to the project root) are monitored. `exclude_dir` provides an exclusion list. The file glob arrays (`include_files`, `exclude_files`) are currently defined in the schema but reserved for future granular filtering — the watcher currently operates on all files within the included directories.

### 3.3 ServiceConfig

```typescript
interface ServiceConfig {
  entrypoint: string;
}
```

Each service is defined solely by its entrypoint path relative to the project root.

### 3.4 NannyOptions

```typescript
interface NannyOptions {
  rootDir: string;
  dryRun?: boolean;
  group?: string;
}
```

Input to the `createNanny()` factory. `dryRun` suppresses process spawning and prints the dependency map instead. `group` restricts the session to a named service group.

### 3.5 DependencyMap

```typescript
interface DependencyMap {
  sharedToServices: Map<string, Set<string>>;
  svcToServices: Map<string, Set<string>>;
  serviceDeps: Map<string, Set<string>>;
  serviceRoots: Map<string, string>;
}
```

The central data structure produced by the scanner and consumed by the watcher and restarter.

| Field | Key | Value | Purpose |
|---|---|---|---|
| `sharedToServices` | Shared package directory name (e.g., `"common"`) | Set of service names that import from that package | Given a shared file change, determines which services to restart |
| `svcToServices` | Service name | Set of service names that depend on this service (transitively resolved) | Given a service file change, determines which additional services to restart |
| `serviceDeps` | Service name | Set of shared package names that the service imports | Diagnostic / reverse lookup |
| `serviceRoots` | Service name | Directory path relative to project root | Maps changed file paths to their owning service |

---

## 4. Module Reference

### 4.1 CLI Entry Point (`src/index.ts`)

The CLI binary performs argument parsing, root directory resolution, and delegates to `createNanny()`.

**Argument parsing** uses a simple sequential scan of `process.argv.slice(2)` with no external dependency (no `yargs`, `commander`, etc.). Flags recognised:

| Flag | Behaviour |
|---|---|
| `--help`, `-h` | Print usage and exit with code 0 |
| `config init` | Generate `nanny.json` in the current working directory and exit |
| `--root <path>` | Set the project root directory |
| `--dry-run` | Enable dry-run mode (no processes spawned) |
| `--group <name>` | Restart session to a single service group |

**Root directory resolution** follows a fallback chain:

1. If `--root <path>` is provided, use it.
2. Otherwise, check if `nanny.json` exists in `process.cwd()`. If yes, use `cwd`.
3. Otherwise, print an error with a message suggesting `nanny config init` and exit with code 1.

**Error handling** wraps `createNanny()` in a try/catch and prints the error message prefixed with `[nanny] error:`.

### 4.2 Public API (`src/api.ts`)

The `createNanny()` factory function orchestrates the full system lifecycle.

**Initialisation sequence:**

1. Resolve and validate `rootDir` (must exist on disk).
2. Instantiate `Logger`.
3. Load and parse `nanny.json` via `Config`.
4. Run `Scanner.build()` to produce the `DependencyMap`.
5. Instantiate `Restarter` and `Watcher`.
6. Resolve the service list (all services, or those in the specified `--group`).

**`NannyInstance` interface:**

```typescript
interface NannyInstance {
  start(): void;
  stop(): void;
  getDependencyMap(): DependencyMap;
}
```

**`start()` lifecycle:**

- In dry-run mode: log the number of services, iterate over `sharedToServices` entries with non-empty service sets and print them, then return immediately.
- In normal mode: iterate over the resolved service list and call `restarter.start()` for each. Log completion. Call `watcher.start()`. Register `SIGINT`/`SIGTERM` handlers that call `watcher.stop()`, `restarter.stopAll()`, and `process.exit(0)`.

**`stop()` lifecycle:** Stops the watcher and kills all child processes. No process exit.

### 4.3 Configuration Loader (`src/pkg/config.ts`)

The `Config` class handles all interaction with `nanny.json`.

**Constructor validation:**

1. Assert the file exists on disk; throw with a remediation hint otherwise.
2. Parse the JSON; throw `"invalid config file"` with the parser error on `SyntaxError`.
3. Assert the presence of `services` (non-null object); throw `'config missing "services" section'`.
4. Assert the presence of `watcher` (non-null object); throw `'config missing "watcher" section'`.
5. If `service_groups` is present, iterate each group and warn (via `logger.warn`) for any service name that does not appear in `services`.

**`Config.init()` (static):**

Creates a minimal `nanny.json` in the given directory. Noop if the file already exists (logged at info level). The template:

```json
{
  "watcher": {
    "include_dir": ["pkg", "services"],
    "exclude_dir": [],
    "include_files": ["*.ts", "*.js"],
    "exclude_files": []
  },
  "service_groups": {},
  "services": {}
}
```

**Getter reference:**

| Method | Returns | Error Condition |
|---|---|---|
| `getConfig()` | Full `NannyConfig` | --- |
| `getServices()` | `Record<string, ServiceConfig>` | --- |
| `getServiceNames()` | `string[]` | --- |
| `getWatcherConfig()` | `WatcherConfig` | --- |
| `getServiceGroups()` | `Record<string, string[]>` | --- |
| `getServiceGroup(name)` | `string[]` | Throws if group name not found |
| `getEntrypoint(name)` | `string` | Throws if service name not found |
| `hasService(name)` | `boolean` | --- |

### 4.4 Logger (`src/pkg/logger.ts`)

A minimal, single-purpose logging class. All messages are prefixed with `[nanny]` and routed to the corresponding `console` method:

| Level | Method | Target |
|---|---|---|
| `info` | `console.log` | stdout |
| `warn` | `console.warn` | stderr |
| `error` | `console.error` | stderr |

### 4.5 Scanner (`src/pkg/scanner.ts`)

The scanner is the intelligence of the system. It uses the `dscan` library to perform static analysis of the TypeScript project and constructs the `DependencyMap`.

**Algorithm (`build()` method):**

**Phase 1 — File classification:**

1. Invoke `scanProject()` from `dscan` with the project root, producing an object that provides `getAllFiles()` and `getAllDependants(file)`.
2. Iterate over all service names from config and extract their root directories (`path.dirname(entrypoint)`), storing them in `serviceRoots`.
3. Iterate over all files returned by `getAllFiles()`, computing each file's path relative to `rootDir`.
4. For each file, attempt to match against `serviceRoots` entries. If the relative path equals or starts with a service root, classify the file as belonging to that service (`fileToSvcName`).
5. If the file is not owned by any service, derive a shared package name from the second path segment (e.g., `pkg/common/index.ts` -> `"common"`) and classify it as a shared package file (`fileToPkgName`).

**Phase 2 — Shared package dependency resolution:**

1. For each shared package file, call `getAllDependants(file)` to retrieve every file that imports it (transitively, via dscan).
2. For each dependant, look up its owning service in `fileToSvcName`. If one exists, add the service to `sharedToServices[packageName]` and add the package name to `serviceDeps[serviceName]`.

**Phase 3 — Cross-service dependency resolution:**

1. Group service files by service name (`svcFileGroups`).
2. For each service's files, call `getAllDependants(file)` and check whether the dependant belongs to a different service. If so, add that service to `svcToServices[owningService]`.

**Important semantics:**

- `svcToServices` captures **the inverse** of the dependency direction: if service B imports from service A, then `svcToServices["A"]` includes `"B"`. This is because the map is consumed by the watcher to answer "when service A changes, which other services must restart?"
- `serviceRoots` only includes entries for services whose entrypoint directory is neither `.` nor empty. Flat entrypoints produce no `serviceRoots` entry, meaning service file changes for such services are not detected via the service-root matching path (they may still be affected via the shared-package path or cross-service path).

### 4.6 Watcher (`src/pkg/watcher.ts`)

The watcher monitors the file system and translates change events into restart commands.

**Initialisation:**

Uses `chokidar.watch()` on the `include_dir` array from config. The `cwd` is set to `apiRoot` so all paths are relative. The `ignored` function excludes:
- Hidden files/directories (matching `/\./`).
- Any path under an `exclude_dir` entry.

The watcher registers a `"change"` event handler that accumulates changed file paths into a `Set<string>` (`this.pending`). An `"error"` event handler logs the error.

**Debounce mechanism:**

Each `"change"` event schedules a flush via `setTimeout(flush, 250)`. If another change arrives within 250ms, the previous timer is cleared and a new one is set. This coalesces rapid file changes (editor atomic saves, bulk writes) into a single restart cycle.

**Flush algorithm:**

When the timer fires, the `flush()` method iterates over all pending file paths:

1. **Service file match:** Check `serviceRoots` to determine if the changed file belongs to a service. If matched, add the owning service to `toRestart`. Then consult `svcToServices[owningService]` and transitively add all services that depend on it.
2. **Shared package match (fallback):** If no service root matched, split the file path into segments. Use the second segment as the shared package name. Look up `sharedToServices[sharedName]` and add all affected services to `toRestart`. If the lookup yields an empty set, log an informational message.
3. If `toRestart` is non-empty, log a summary line and call `restarter.restartAll(toRestart)`.
4. Clear the pending set.

### 4.7 Restarter (`src/pkg/restarter.ts`)

Manages child process creation, termination, and lifecycle tracking.

**Process spawning (`start()`):**

Each service is spawned via `child_process.spawn("node", [...], { cwd, stdio, env })`. The spawn arguments include:
- `-r tsconfig-paths/register` — resolves TypeScript path aliases at runtime.
- `-r ts-node/register/transpile-only` — compiles TypeScript on the fly without type checking.
- The entrypoint path.

Environment: inherits the parent's environment with `TS_NODE_CACHE` forced to `"0"` to prevent stale compilation caches.

**Stdio handling:**

Child stdout and stderr are piped. Each line is prefixed with `[serviceName]` and forwarded to the parent's stdout/stderr respectively. Lines are split on `\n` to ensure correct interleaving.

**Lifecycle events:**

- `"exit"`: removes the process from the internal `Map`, logs the exit code. No auto-restart.
- `"error"`: removes the process, logs the error message.

**`restartAll()`:**

1. Sends `SIGTERM` to each process in the list and removes it from the map.
2. Waits 1000ms (`sleep(1000)`) to allow ports to be released and file handles to close.
3. Spawns each process anew via `start()`.

**`stopAll()`:**

Iterates over all tracked processes, sends `SIGTERM`, and clears the map. No grace period, no `SIGKILL` fallback.

---

## 5. Data Flow and Lifecycle

### 5.1 Startup Sequence

```
CLI / API call
    |
    v
createNanny(options)
    +-- resolve & validate rootDir
    +-- new Logger()
    +-- new Config(rootDir) -> parse nanny.json
    +-- new Scanner(rootDir, config) -> build dependency map
    |       +-- dscan.scanProject() -> all files + dependants
    |       +-- classify files -> service-owned vs shared
    |       +-- resolve shared -> service dependencies
    |       +-- resolve cross-service dependencies
    +-- new Restarter(rootDir, config)
    +-- new Watcher(rootDir, depMap, restarter, config)
    |
    v
NannyInstance.start()
    +-- (dry-run?) print dep map & return
    +-- restarter.start(svc) for each service
    +-- watcher.start() -> chokidar begins watching
    +-- register SIGINT/SIGTERM handlers
```

### 5.2 File Change Lifecycle

```
chokidar "change" event
    |
    v
pending.add(filePath)
scheduleFlush() -> setTimeout(flush, 250)
    |
    v (250ms debounce, or new event resets timer)
flush()
    +-- for each pending filePath:
    |   +-- match vs serviceRoots -> add owning service + dependants
    |   +-- fallback: match shared package -> add affected services
    |
    v
restarter.restartAll(services)
    +-- SIGTERM each matching process
    +-- sleep(1000)
    +-- spawn each process
```

### 5.3 Shutdown Sequence

```
SIGINT/SIGTERM
    |
    v
watcher.stop() -> clearTimeout(timer), chokidar.close()
restarter.stopAll() -> SIGTERM all processes
process.exit(0)
```

Or programmatically:

```
nannyInstance.stop()
    +-- watcher.stop()
    +-- restarter.stopAll()
```

---

## 6. Dependency Resolution Algorithm

The scanner's dependency resolution is a two-pass algorithm over the file graph produced by `dscan`.

### 6.1 Service Classification

A file is classified as belonging to service `S` if its relative path (from `rootDir`) falls under `path.dirname(S.entrypoint)`. This means:

- `services/auth/app.ts` with entrypoint `services/auth/app.ts` has root `services/auth`.
- `services/auth/routes/login.ts` also belongs to `auth`.
- A file at `pkg/common/helpers.ts` does not match any service root and is classified as a shared package.

**Important:** Entrypoints at the root level (e.g., `app.ts` with `path.dirname` returning `"."`) produce no `serviceRoots` entry, so service-owned file detection is effectively disabled for that service.

### 6.2 Shared Package Naming

Shared packages are named by the second segment of their relative path:

| Relative Path | Package Name |
|---|---|
| `pkg/common/index.ts` | `common` |
| `lib/utils/helpers.ts` | `utils` |
| `packages/shared/src/index.ts` | `shared` |

This convention assumes a flat directory structure where each directory under a top-level shared directory represents one package.

### 6.3 Cross-Service Resolution

For each file owned by service `S`, the scanner queries `dscan.getAllDependants(file)`. Any dependant file owned by a different service `T` produces an entry `svcToServices[S] <- T`. This is computed transitively: if service C imports from B which imports from A, then `svcToServices["A"]` contains both `"B"` and `"C"`.

---

## 7. File Change Matching

When a file change event arrives, the watcher must determine which services to restart. The matching logic has two branches:

### 7.1 Service-Root Match (preferred path)

Iterate `serviceRoots` entries. If the changed file path equals or starts with the service root directory, the file belongs to that service. The owning service itself is restarted, plus any services recorded in `svcToServices[owningService]`.

### 7.2 Shared-Package Match (fallback path)

If no service root matched, split the file path on the OS path separator. The second segment (index 1) is used as the shared package name. Look up `sharedToServices[packageName]` and restart every service in that set.

If the set is empty (no service depends on that package), an informational message is logged and no restart occurs.

### 7.3 Edge Cases in Matching

| Scenario | Behaviour |
|---|---|
| File in a nested shared directory (e.g., `pkg/common/sub/helper.ts`) | Second segment is `"common"` -> correct |
| File at root level of the project | Neither branch matches; no restart |
| Service entrypoint is at project root (`"."`) | No `serviceRoots` entry; no service file match for that service |
| Change to a file in a watched directory outside any service and not a known shared package | Logs informational message; no restart |

---

## 8. Process Management

### 8.1 Spawn Strategy

Services are spawned with `child_process.spawn()` rather than `exec()` or `fork()` to allow streaming stdout/stderr and avoid buffer deadlocks. The `cwd` is set to the project root so relative entrypoint paths resolve correctly.

### 8.2 Graceful Restart

The `restartAll()` method sends `SIGTERM` and waits 1000ms before respawning. There is no:
- `SIGKILL` fallback if a process does not terminate.
- Port-release verification before respawn (may cause `EADDRINUSE` on quick restarts).
- Health check before considering the service restarted.

### 8.3 Crash Behaviour

When a child process exits (whether by normal termination, crash, or `SIGTERM`), the restarter logs the exit code and removes the process from its internal map. No automatic restart occurs. The process is only restarted when the watcher detects a subsequent file change.

---

## 9. Configuration Schema

### 9.1 nanny.json

```jsonc
{
  "watcher": {
    "include_dir": ["pkg", "services"],       // required
    "exclude_dir": [],                         // optional, default []
    "include_files": ["*.ts", "*.js"],         // reserved for future use
    "exclude_files": []                        // reserved for future use
  },
  "service_groups": {                          // optional, default {}
    "group-name": ["service-a", "service-b"]
  },
  "services": {                                // required
    "service-name": {
      "entrypoint": "relative/path/to/entrypoint.ts"
    }
  }
}
```

### 9.2 Validation Rules

| Condition | Response |
|---|---|
| File missing | Throw `"config file not found"` with hint |
| File contains invalid JSON | Throw `"invalid config file"` with parser error |
| `services` section missing/null | Throw `'config missing "services" section'` |
| `watcher` section missing/null | Throw `'config missing "watcher" section'` |
| Service group references unknown service | Log warning at construction time |
| `service_groups` absent | `getServiceGroups()` returns `{}`; `getServiceGroup()` throws if called |
| Unknown service name in getter | Throw `"unknown service"` |

---

## 10. Test Strategy

The test suite uses Node's built-in test runner (`node:test` with `node:assert/strict`) and `tsx` for TypeScript transpilation.

### 10.1 Test Configuration

Tests are executed with:

```bash
node --import tsx --test src/*.test.ts src/**/*.test.ts
```

Test files are excluded from the production TypeScript compilation via `tsconfig.json`.

### 10.2 Test Isolation

Each test suite creates a temporary directory via `fs.mkdtempSync()`, writes a minimal project structure (source files, `tsconfig.json`, `nanny.json`), and cleans up with `fs.rmSync(tmpDir, { recursive: true, force: true })` in an `after` hook. This ensures no state leaks between test cases.

### 10.3 Config Tests (`config.test.ts`)

| Test Group | Scope |
|---|---|
| `Config.init` | File creation, idempotent skip |
| `Config constructor` | Valid load, missing file, invalid JSON, missing `services`, missing `watcher` |
| `Config getters` | `getServiceNames`, `getServices`, `getServiceGroup`, `getServiceGroups`, `getEntrypoint`, `hasService`, `getWatcherConfig`, `getConfig` |
| `Config warnings` | Group referencing missing service |
| `Config service_groups fallback` | Absent groups field returns `{}` |

### 10.4 Scanner Tests (`scanner.test.ts`)

| Test Group | Scope |
|---|---|
| `basic` | Two services each importing from a different shared package. Validates `sharedToServices`, `serviceDeps`, `svcToServices` (empty for no cross-service imports), `serviceRoots`. |
| `cross-svc` | Three-service chain (`auth -> users -> cases`). Validates direct cross-service detection, transitive detection, and self-dependency exclusion. |
| `flexible` | Non-standard directory structure (`lib/`, `apps/`). Validates the scanner works independently of the `pkg`/`services` convention. |

### 10.5 CLI Tests (`index.test.ts`)

| Test Group | Scope |
|---|---|
| `--help` / `-h` | Prints usage, exits 0 |
| `config init` | Creates config, skip on re-run |
| `--root auto-detect` | Uses cwd when `nanny.json` present, errors when absent |
| `CLI errors` | Missing root directory, missing config file |

---

## 11. Dependencies

### 11.1 Runtime

| Package | Version | Purpose |
|---|---|---|
| `chokidar` | ^4.0.3 | Cross-platform file system watching with debounce, atomic-save handling, and recursive directory support |
| `dscan` | ^1.0.4 | Static dependency scanner for TypeScript/JavaScript projects; provides `scanProject()`, `getAllFiles()`, and `getAllDependants()` |

### 11.2 Development

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.9.2 | TypeScript compiler |
| `tsx` | ^4.20.5 | TypeScript execution for Node.js (used in dev mode and tests) |
| `@types/node` | ^22.15.3 | Node.js type definitions |

---

## 12. Design Decisions and Tradeoffs

### 12.1 Static Dependency Analysis at Startup

**Decision:** The dependency graph is computed once at startup and never updated.

**Rationale:** Re-scanning the entire project on every file change would defeat the performance benefit of selective restarting. Dynamic imports and file additions during a session are not detected until nanny itself is restarted. This is a deliberate tradeoff favouring predictable, low-latency restart cycles.

### 12.2 250ms Debounce Window

**Decision:** Change events are coalesced over a 250ms window.

**Rationale:** Editor atomic saves (write-to-temp + rename) can produce multiple rapid events for the same file. npm/yarn installs and git operations can produce thousands of events in under a second. The debounce batch processes all accumulated changes in a single restart cycle, preventing restart storms.

### 12.3 No Auto-Restart on Crash

**Decision:** Crashed services are not automatically restarted.

**Rationale:** A crashing service may indicate a serious issue (port conflict, compilation error, runtime fault) that will not resolve without a code change. Auto-restarting would produce log spam and potentially mask the problem. The developer makes a code change, which triggers the watcher, which restarts the service.

### 12.4 TypeScript Transpilation at Runtime

**Decision:** Services are spawned with `ts-node/register` rather than pre-compiled JavaScript.

**Rationale:** Nanny is designed for development workflows. Requiring a build step before each run would negate the developer experience gains of automatic restarting. The `transpile-only` flag avoids type-checking overhead.

### 12.5 SIGTERM Without SIGKILL Fallback

**Decision:** Processes are killed with SIGTERM only.

**Rationale:** In a development context, services should shut down gracefully. A SIGKILL fallback (after a timeout) is not implemented, which means a misbehaving process that ignores SIGTERM will remain running as an orphan. This is an acknowledged limitation.

---

## 13. Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| No port-release verification | `EADDRINUSE` errors on rapid restarts | Increase the 1000ms sleep in `restartAll()` or configure `SO_REUSEADDR` in services |
| Stale dependency graph | New imports/additions during a session go undetected | Restart nanny after significant structural changes |
| No SIGKILL fallback | Orphan processes if SIGTERM is ignored | Manually kill orphaned processes |
| No lazy/sparse startup | All services in the group start immediately | Use `--group` to limit scope |
| Single-project focus | Does not handle multi-repo architectures | Use one nanny instance per repository |
| Flat shared-package naming | Deeply nested structures may produce unexpected package names | Keep shared directories one level deep |

---

## 14. Error Codes

| Exit Code | Condition |
|---|---|
| 0 | Normal termination (including `--help`, `config init`) |
| 1 | Configuration error, missing root, unknown group, or runtime error during `createNanny()` |
