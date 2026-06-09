export interface NannyConfig {
  watcher: WatcherConfig;
  service_groups: Record<string, string[]>;
  services: Record<string, ServiceConfig>;
}

export interface WatcherConfig {
  include_dir: string[];
  exclude_dir: string[];
  include_files: string[];
  exclude_files: string[];
}

export interface ServiceConfig {
  entrypoint: string;
}

export interface NannyOptions {
  rootDir: string;
  dryRun?: boolean;
  group?: string;
}

export interface DependencyMap {
  sharedToServices: Map<string, Set<string>>;
  svcToServices: Map<string, Set<string>>;
  serviceDeps: Map<string, Set<string>>;
  serviceRoots: Map<string, string>;
}
