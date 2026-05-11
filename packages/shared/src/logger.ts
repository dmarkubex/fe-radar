import pino from "pino";

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "token",
  "cookie",
  "authorization",
  "headers.cookie",
  "headers.authorization",
  "unionid",
  "mobile",
  "phone"
];

export interface LoggerOptions {
  service: string;
  requestId?: string;
  userId?: number | string;
}

export function createLogger(options: LoggerOptions): pino.Logger {
  return pino({
    name: options.service,
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
    base: {
      service: options.service,
      requestId: options.requestId,
      userId: options.userId
    },
    serializers: {
      err: pino.stdSerializers.err
    },
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]"
    }
  });
}

export { REDACT_PATHS };
