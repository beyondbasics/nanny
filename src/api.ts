import fs from "node:fs";
import path from "node:path";
import type { NannyOptions, DependencyMap } from "./pkg/types.js";
import { Logger } from "./pkg/logger.js";
import { Config } from "./pkg/config.js";
import { Scanner } from "./pkg/scanner.js";
import { Restarter } from "./pkg/restarter.js";
import { Watcher } from "./pkg/watcher.js";
import { NannyError, ErrorCodes } from "./pkg/errors.js";

export type { NannyOptions, DependencyMap };

export interface NannyInstance {
  start(): void;
  stop(): void;
  getDependencyMap(): DependencyMap;
}

export function createNanny(options: NannyOptions): NannyInstance {
  const rootDir = path.resolve(options.rootDir);

  if (!fs.existsSync(rootDir)) {
    throw new NannyError(ErrorCodes.ROOT_NOT_FOUND, { path: rootDir });
  }

  const logger = new Logger();
  const cfg = new Config(rootDir, logger);
  const config = cfg.getConfig();

  const scanner = new Scanner(rootDir, config, logger);
  const depMap = scanner.build();

  const restarter = new Restarter(rootDir, config, logger);
  const watcher = new Watcher(
    rootDir,
    depMap,
    restarter,
    config.watcher,
    logger,
  );

  let services: string[];
  if (options.group) {
    services = cfg.getServiceGroup(options.group);
  } else {
    services = cfg.getServiceNames();
  }

  return {
    start(): void {
      logger.info(`starting ${services.length} services...`);

      if (!options.dryRun) {
        for (const svc of services) {
          restarter.start(svc);
        }
        logger.info(`all ${services.length} services starting`);
      } else {
        logger.info(`dry-run: would start ${services.length} services`);
        logger.info(`dependency map:`);
        for (const [name, svcs] of depMap.sharedToServices) {
          if (svcs.size > 0) {
            console.log(`  ${name} → ${[...svcs].join(", ")}`);
          }
        }
        return;
      }

      watcher.start();

      const shutdown = () => {
        logger.info(`shutting down...`);
        watcher.stop();
        restarter.stopAll();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    },

    stop(): void {
      watcher.stop();
      restarter.stopAll();
    },

    getDependencyMap(): DependencyMap {
      return depMap;
    },
  };
}
