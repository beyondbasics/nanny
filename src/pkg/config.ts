import fs from "node:fs";
import path from "node:path";
import type { NannyConfig, ServiceConfig, WatcherConfig } from "./types.js";
import { Logger } from "./logger.js";
import { NannyError, ErrorCodes } from "./errors.js";

export class Config {
  private config: NannyConfig;

  constructor(rootDir: string, logger: Logger) {
    const configPath = path.join(rootDir, "nanny.json");

    if (!fs.existsSync(configPath)) {
      throw new NannyError(ErrorCodes.CONFIG_NOT_FOUND, { path: configPath });
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (err) {
      throw new NannyError(ErrorCodes.CONFIG_INVALID_PARSE, {
        detail: err instanceof SyntaxError ? err.message : "failed to parse",
      });
    }

    if (!raw.services || typeof raw.services !== "object") {
      throw new NannyError(ErrorCodes.CONFIG_MISSING_SERVICES);
    }

    if (!raw.watcher || typeof raw.watcher !== "object") {
      throw new NannyError(ErrorCodes.CONFIG_MISSING_WATCHER);
    }

    if (raw["service_groups"]) {
      for (const [groupName, svcs] of Object.entries(
        raw["service_groups"] as Record<string, string[]>,
      )) {
        for (const svc of svcs) {
          if (!(raw.services as Record<string, unknown>)[svc]) {
            logger.warn(
              `service "${svc}" in group "${groupName}" not found in services`,
            );
          }
        }
      }
    }

    this.config = raw as unknown as NannyConfig;
  }

  getConfig(): NannyConfig {
    return this.config;
  }

  getServices(): Record<string, ServiceConfig> {
    return this.config.services;
  }

  getServiceNames(): string[] {
    return Object.keys(this.config.services);
  }

  getWatcherConfig(): WatcherConfig {
    return this.config.watcher;
  }

  getServiceGroups(): Record<string, string[]> {
    return this.config["service_groups"] ?? {};
  }

  getServiceGroup(name: string): string[] {
    const group = this.config["service_groups"]?.[name];
    if (!group) {
      throw new NannyError(ErrorCodes.SERVICE_GROUP_NOT_FOUND, { name });
    }
    return group;
  }

  getEntrypoint(serviceName: string): string {
    const svc = this.config.services[serviceName];
    if (!svc) {
      throw new NannyError(ErrorCodes.SERVICE_NOT_FOUND, { name: serviceName });
    }
    return svc.entrypoint;
  }

  hasService(serviceName: string): boolean {
    return serviceName in this.config.services;
  }

  static init(rootDir: string): void {
    const configPath = path.join(rootDir, "nanny.json");

    if (fs.existsSync(configPath)) {
      console.log(`[nanny] config already exists: ${configPath}`);
      return;
    }

    const base: NannyConfig = {
      watcher: {
        include_dir: ["pkg", "services"],
        exclude_dir: [],
        include_files: ["*.ts", "*.js"],
        exclude_files: [],
      },
      service_groups: {},
      services: {},
    };

    fs.writeFileSync(configPath, JSON.stringify(base, null, 2) + "\n");
    console.log(`[nanny] created config: ${configPath}`);
  }
}
