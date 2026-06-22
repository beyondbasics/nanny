export const ErrorCodes = {
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_INVALID_PARSE: "CONFIG_INVALID_PARSE",
  CONFIG_MISSING_SERVICES: "CONFIG_MISSING_SERVICES",
  CONFIG_MISSING_WATCHER: "CONFIG_MISSING_WATCHER",
  SERVICE_GROUP_NOT_FOUND: "SERVICE_GROUP_NOT_FOUND",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  SPAWN_ERROR: "SPAWN_ERROR",
  ROOT_NOT_FOUND: "ROOT_NOT_FOUND",
};

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

type MessageFn = (ctx: Record<string, string>) => string;

const MESSAGES: Record<string, MessageFn> = {
  [ErrorCodes.CONFIG_NOT_FOUND]: (ctx) =>
    `config file not found: ${ctx.path}\n  Run \`nanny config init\` to generate one`,
  [ErrorCodes.CONFIG_INVALID_PARSE]: (ctx) =>
    `invalid config file: ${ctx.detail}`,
  [ErrorCodes.CONFIG_MISSING_SERVICES]: () => 'config missing "services" section',
  [ErrorCodes.CONFIG_MISSING_WATCHER]: () => 'config missing "watcher" section',
  [ErrorCodes.SERVICE_GROUP_NOT_FOUND]: (ctx) =>
    `unknown service group: "${ctx.name}"`,
  [ErrorCodes.SERVICE_NOT_FOUND]: (ctx) => `unknown service: "${ctx.name}"`,
  [ErrorCodes.SPAWN_ERROR]: (ctx) => `${ctx.name} spawn error: ${ctx.detail}`,
  [ErrorCodes.ROOT_NOT_FOUND]: (ctx) => `root directory not found: ${ctx.path}`,
};

export class NannyError extends Error {
  constructor(
    public code: ErrorCode,
    context: Record<string, string> = {},
  ) {
    super(MESSAGES[code](context));
    this.name = "NannyError";
  }
}
