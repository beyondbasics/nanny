import { scanProject } from "dscan";
import path from "node:path";
import type { DependencyMap, NannyConfig } from "./types.js";
import { Logger } from "./logger.js";

export class Scanner {
  constructor(
    private rootDir: string,
    private config: NannyConfig,
    private logger: Logger,
  ) {}

  build(): DependencyMap {
    this.logger.info(`scanning ${this.rootDir}...`);
    const result = scanProject({ rootDir: this.rootDir });

    const allFiles = result.getAllFiles();
    const serviceNames = Object.keys(this.config.services);

    const serviceRoots = new Map<string, string>();
    for (const name of serviceNames) {
      const dir = this.config.services[name].entrypoint;
      const root = path.dirname(dir).replace(/\\/g, "/");
      if (root !== "." && root !== "") {
        serviceRoots.set(name, root);
      }
    }

    this.logger.info(
      `found ${serviceNames.length} services, ${allFiles.length} files`,
    );

    const fileToSvcName = new Map<string, string>();
    const fileToPkgName = new Map<string, string>();

    for (const file of allFiles) {
      const relative = path.relative(this.rootDir, file).replace(/\\/g, "/");
      let owned = false;
      for (const [svcName, svcDir] of serviceRoots) {
        if (relative.startsWith(svcDir + "/")) {
          fileToSvcName.set(file, svcName);
          owned = true;
          break;
        }
      }
      if (!owned) {
        fileToPkgName.set(file, path.dirname(relative));
      }
    }

    const sharedGroupNames = [...new Set(fileToPkgName.values())];

    const sharedToServices = new Map<string, Set<string>>();
    const svcToServices = new Map<string, Set<string>>();
    const serviceDeps = new Map<string, Set<string>>();

    for (const svc of serviceNames) {
      serviceDeps.set(svc, new Set());
      svcToServices.set(svc, new Set());
    }
    for (const name of sharedGroupNames) {
      sharedToServices.set(name, new Set());
    }

    this.logger.info(
      `resolving dependencies for ${fileToPkgName.size} shared files across ${sharedGroupNames.length} groups...`,
    );

    for (const [pkgFile, pkgName] of fileToPkgName) {
      const dependants = result.getAllDependants(pkgFile);
      for (const dep of dependants) {
        const svcName = fileToSvcName.get(dep);
        if (svcName) {
          sharedToServices.get(pkgName)!.add(svcName);
          serviceDeps.get(svcName)!.add(pkgName);
        }
      }
    }

    const usedSharedCount = [...sharedToServices.values()].filter(
      (s) => s.size > 0,
    ).length;
    this.logger.info(
      `dependency map built: ${usedSharedCount}/${sharedGroupNames.length} shared groups have dependants`,
    );

    const svcFileGroups = new Map<string, string[]>();
    for (const [file, svcName] of fileToSvcName) {
      if (!svcFileGroups.has(svcName)) svcFileGroups.set(svcName, []);
      svcFileGroups.get(svcName)!.push(file);
    }

    this.logger.info(
      `resolving cross-service dependencies for ${serviceNames.length} services...`,
    );

    for (const [svcName, files] of svcFileGroups) {
      for (const file of files) {
        const dependants = result.getAllDependants(file);
        for (const dep of dependants) {
          const depSvcName = fileToSvcName.get(dep);
          if (depSvcName && depSvcName !== svcName) {
            svcToServices.get(svcName)!.add(depSvcName);
          }
        }
      }
    }

    const usedSvcCount = [...svcToServices.values()].filter(
      (s) => s.size > 0,
    ).length;
    this.logger.info(
      `cross-service dependency map built: ${usedSvcCount}/${serviceNames.length} services have dependants`,
    );

    return { sharedToServices, svcToServices, serviceDeps, serviceRoots };
  }
}
