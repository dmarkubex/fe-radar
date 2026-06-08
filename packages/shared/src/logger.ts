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
  "phone",
  // v1.1 钉钉机器人凭据（CLAUDE.md 陷阱 #11 / requirements §12 验收第 10 项）。
  // camelCase（JS 对象字段）+ snake_case（DB 行字段）双写，确保两种日志形态都被脱敏。
  "webhookUrl",
  "signSecret",
  "webhook_url",
  "sign_secret",
  "webhook",
  "sign"
];

export interface LoggerOptions {
  service: string;
  requestId?: string;
  userId?: number | string;
  /** 额外 redact 路径，与全局 REDACT_PATHS 合并（模块级敏感字段用）。 */
  redactPaths?: string[];
  /** 测试用：注入可捕获的输出流以断言序列化结果。生产不传，默认写 stdout。 */
  destination?: pino.DestinationStream;
}

export function createLogger(options: LoggerOptions): pino.Logger {
  const pinoOptions: pino.LoggerOptions = {
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
      paths: [...REDACT_PATHS, ...(options.redactPaths ?? [])],
      censor: "[REDACTED]"
    }
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}

export { REDACT_PATHS };
