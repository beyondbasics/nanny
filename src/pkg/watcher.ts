import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { DependencyMap, WatcherConfig } from "./types.js";
import { Restarter } from "./restarter.js";
import { Logger } from "./logger.js";

export class Watcher {
  private apiRoot: string;
  private depMap: DependencyMap;
  private restarter: Restarter;
  private config: WatcherConfig;
  private logger: Logger;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;

  constructor(
    apiRoot: string,
    depMap: DependencyMap,
    restarter: Restarter,
    config: WatcherConfig,
    logger: Logger,
  ) {
    this.apiRoot = apiRoot;
    this.depMap = depMap;
    this.restarter = restarter;
    this.config = config;
    this.logger = logger;
  }

  start(): void {
    const excludeDirs = this.config.exclude_dir ?? [];

    this.watcher = chokidar.watch(this.config.include_dir, {
      cwd: this.apiRoot,
      ignored: (path: string) => {
        if (/(^|[\/\\])\../.test(path)) return true;
        for (const dir of excludeDirs) {
          const normalized = dir.endsWith("/") ? dir : dir + "/";
          if (path.startsWith(normalized) || path === dir) return true;
        }
        return false;
      },
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on("change", (filePath: string) => {
      this.pending.add(filePath);
      this.scheduleFlush();
    });

    this.watcher.on("error", (err: unknown) => {
      this.logger.error(
        `watch error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.watcher) this.watcher.close();
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  private async flush(): Promise<void> {
    const toRestart = new Set<string>();

    for (const filePath of this.pending) {
      const sep = filePath.includes("\\") ? "\\" : "/";
      const parts = filePath.split(sep);

      let matched = false;
      for (const [svcName, svcDir] of this.depMap.serviceRoots) {
        if (filePath === svcDir || filePath.startsWith(svcDir + "/")) {
          toRestart.add(svcName);
          const dependantSvcs = this.depMap.svcToServices.get(svcName);
          if (dependantSvcs) {
            for (const svc of dependantSvcs) toRestart.add(svc);
          }
          matched = true;
          break;
        }
      }

      if (!matched) {
        const sharedName = path.dirname(filePath);
        const affected = this.depMap.sharedToServices.get(sharedName);
        if (affected && affected.size > 0) {
          for (const svc of affected) toRestart.add(svc);
        } else {
          this.logger.info(
            `${filePath} changed — no services depend on shared group "${sharedName}"`,
          );
        }
      }
    }

    if (toRestart.size > 0) {
      const fileSummary = [...this.pending].join(", ");
      const svcList = [...toRestart].join(", ");
      this.logger.info(`${fileSummary} → restarting: ${svcList}`);

      await this.restarter.restartAll([...toRestart]);
    }

    this.pending.clear();
  }
}
