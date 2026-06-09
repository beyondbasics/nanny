import { spawn, type ChildProcess } from "node:child_process";
import type { NannyConfig } from "./types.js";
import { Logger } from "./logger.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Restarter {
  private processes = new Map<string, ChildProcess>();
  private apiRoot: string;
  private config: NannyConfig;
  private logger: Logger;

  constructor(apiRoot: string, config: NannyConfig, logger: Logger) {
    this.apiRoot = apiRoot;
    this.config = config;
    this.logger = logger;
  }

  start(serviceName: string): void {
    const entrypoint = this.config.services[serviceName]?.entrypoint;
    if (!entrypoint) {
      this.logger.error(`unknown service: "${serviceName}"`);
      return;
    }

    const proc = spawn(
      "node",
      [
        "-r",
        "tsconfig-paths/register",
        "-r",
        "ts-node/register/transpile-only",
        entrypoint,
      ],
      {
        cwd: this.apiRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, TS_NODE_CACHE: "0" },
      },
    );

    const prefix = `[${serviceName}]`;

    proc.stdout!.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        process.stderr.write(`${prefix} ${line}\n`);
      }
    });

    proc.on("exit", (code) => {
      this.processes.delete(serviceName);
      this.logger.info(`${serviceName} exited with code ${code}`);
    });

    proc.on("error", (err) => {
      this.logger.error(`${serviceName} spawn error: ${err.message}`);
      this.processes.delete(serviceName);
    });

    this.processes.set(serviceName, proc);
  }

  stop(serviceName: string): void {
    const proc = this.processes.get(serviceName);
    if (!proc) return;
    proc.kill("SIGTERM");
    this.processes.delete(serviceName);
  }

  async restartAll(serviceNames: string[]): Promise<void> {
    for (const name of serviceNames) {
      const proc = this.processes.get(name);
      if (proc) {
        proc.kill("SIGTERM");
        this.processes.delete(name);
      }
    }

    await sleep(1000);

    for (const name of serviceNames) {
      this.start(name);
    }
  }

  stopAll(): void {
    for (const [name, proc] of this.processes) {
      proc.kill("SIGTERM");
      this.processes.delete(name);
    }
  }
}
