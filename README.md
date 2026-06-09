# nanny

Dependency-aware process manager for Node.js microservice architectures and monorepos. Nanny selectively restarts only the services affected by a file change, eliminating the need to kill and restart everything during development.

## Features

- **Selective restart** — When a file changes, only services that depend on it are restarted, not the entire fleet.
- **Dependency-aware** — Uses static analysis (`dscan`) to build a dependency graph at startup. Tracks both package-to-service and service-to-service dependencies.
- **Debounced file watching** — Built on chokidar, handles editor atomic saves, rapid changes, and cross-platform file watching (inotify, fsevents).
- **Config-driven** — Declare services, entrypoints, watcher paths, and service groups in a `nanny.json` manifest.
- **Service groups** — Start a subset of services with `--group` for targeted development.
- **Transitive resolution** — If service A depends on service B and service B depends on package C, changing C restarts both A and B.
- **Dry-run mode** — Preview the dependency map without starting any processes.
- **Programmatic API** — Use `createNanny()` directly from Node.js code.

## Installation

```bash
npm install nanny
```

Or run directly with `tsx` during development:

```bash
npx nanny --root ./api
```

## Quick Start

### 1. Generate a configuration file

```bash
nanny config init
```

This creates a `nanny.json` in the current directory. Edit it to declare your services:

```json
{
  "watcher": {
    "include_dir": ["pkg", "services"],
    "exclude_dir": [],
    "include_files": ["*.ts", "*.js"],
    "exclude_files": []
  },
  "service_groups": {
    "payments": ["auth", "payments", "users"]
  },
  "services": {
    "auth":    { "entrypoint": "services/auth/app.ts" },
    "users":   { "entrypoint": "services/users/app.ts" },
    "payments": { "entrypoint": "services/payments/app.ts" }
  }
}
```

### 2. Start watching

```bash
nanny
# or 
nanny --root ./api
# or 
nanny --root ./api --group auth
```

Nanny scans all TypeScript files, builds the dependency graph, starts every service, and begins watching for changes.

### 3. Make a change

Edit a shared package file. Nanny restarts only the services that transitively depend on it — the rest keep running.

## CLI

```
Usage:
  nanny [options]
  nanny config init

Options:
  --root <path>   Path to the api project root (required)
  --group <name>  Only start services in the named group
  --dry-run       Print dependency map without starting services
  --help, -h      Show this help

Commands:
  config init     Generate a base nanny.json in the current directory
```

### Examples

```bash
# Start all services
nanny --root ~/Projects/api

# Start only the "payments" group
nanny --root ~/Projects/api --group payments

# Preview the dependency map
nanny --root ~/Projects/api --dry-run

# Generate a config in the current project
nanny config init
```

## Programmatic API

```typescript
import { createNanny } from "nanny";

const nanny = createNanny({
  rootDir: "/path/to/api",
  dryRun: false,
  group: "payments",
});

nanny.start();
// services are now running and being watched

// later:
nanny.stop();

const map = nanny.getDependencyMap();
// { pkgToServices, svcToServices, serviceToPkgs }
```

### `createNanny(options)`

| Option    | Type     | Default | Description |
|-----------|----------|---------|-------------|
| `rootDir` | `string` | —       | Path to the project root (required) |
| `dryRun`  | `boolean` | `false` | Print dependency map without starting processes |
| `group`   | `string`  | —       | Only start services in this group |

### `NannyInstance`

| Method              | Description |
|---------------------|-------------|
| `start()`           | Scan, start all services, begin watching |
| `stop()`            | Kill child processes, close file watcher |
| `getDependencyMap()`| Return the `DependencyMap` |

## Configuration

Nanny reads `nanny.json` from the project root. The schema:

| Field | Type | Description |
|-------|------|-------------|
| `watcher` | `object` | File watcher settings |
| `watcher.include_dir` | `string[]` | Directories to watch (required) |
| `watcher.exclude_dir` | `string[]` | Directories to ignore |
| `watcher.include_files` | `string[]` | File globs to include |
| `watcher.exclude_files` | `string[]` | File globs to exclude |
| `service_groups` | `Record<string, string[]>` | Named groups of services |
| `services` | `Record<string, { entrypoint }>` | Service name to entrypoint mapping |

## How It Works

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐
│  Scanner   │────▶│   Watcher    │────▶│  Restarter   │
│  (dscan)   │     │  (chokidar)  │     │  (child_proc)│
└─────┬──────┘     └──────┬───────┘     └──────┬───────┘
      │                   │                    │
      ▼                   ▼                    ▼
 Dependency Map     250ms debounce        Map<svc, PID>
 pkg/ → svc[]       batch flush           spawn / kill
 svc → svc[]
```

### Init

1. `Scanner` runs `dscan.scanProject()` to walk every TypeScript file and resolve all imports.
2. For each package file, dscan's transitive reverse lookup identifies every service that depends on it.
3. For each service file, the same lookup identifies cross-service dependencies.
4. `Restarter` spawns each service's entrypoint as a child process.

### Watch

5. `Watcher` monitors the configured directories via chokidar.
6. File change events are accumulated into a set and flushed every 250ms.
7. On flush: changed paths are mapped to their owning service or package. Package changes trigger a lookup in the dependency map to find affected services. Cross-service changes propagate transitively.
8. `Restarter` sends SIGTERM to affected processes, waits 1s, then respawns them.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Editor atomic save | chokidar coalesces `unlink`+`add` into a single change event |
| Rapid changes (1000+/s) | Debounce window batches everything into one flush |
| Package with no dependants | Logged; no services restart |
| Service file change | The owning service restarts, plus any services that depend on it |
| Cross-service dependency | Transitively resolved — if A depends on B and B changes, both A and B restart |
| Missing `--root` | Error with usage message |
| Missing or invalid `nanny.json` | Clear error prompting `nanny config init` |
| Child process crash | Exit code logged; no auto-restart |

## Limitations

- No port-release wait before restart — may cause `EADDRINUSE` on quick restarts.
- Dependency map is computed once at startup; new imports during a session are not detected until a restart.
- No automatic crash recovery — crashed services stay down.
- No lazy start — all services are spawned immediately. Use `--group` to limit scope.
- No graceful shutdown timeout — SIGTERM is sent with no SIGKILL fallback.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run the CLI in development mode
npm run dev -- --root ./my-project
```

The test suite uses Node's built-in test runner (`node:test`) with `tsx` for TypeScript transpilation.

```bash
npm test
```

## License

ISC
