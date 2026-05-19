export class AppError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  public constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class SourceFetchError extends AppError {
  public constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

export class LlmError extends AppError {
  public constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

export class QuotaExceededError extends AppError {
  public constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

export class NotImplementedError extends AppError {
  public constructor(feature: string) {
    super("NOT_IMPLEMENTED", `${feature} is not implemented yet`);
  }
}

export class BriefingRenderError extends AppError {
  public constructor(code: string, message: string, details?: unknown) {
    super(code, message, details);
  }
}

export class DingtalkBotError extends AppError {
  public readonly errcode?: number;
  public readonly errmsg?: string;

  public constructor(code: string, message: string, details?: unknown, errcode?: number, errmsg?: string) {
    super(code, message, details);
    this.errcode = errcode;
    this.errmsg = errmsg;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError("INTERNAL", error.message);
  }

  return new AppError("INTERNAL", "Unknown error", error);
}
