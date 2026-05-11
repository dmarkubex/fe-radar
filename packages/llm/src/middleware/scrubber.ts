import { scrubText, type ScrubContext, type ScrubResult } from "@fe-radar/core";
import { LlmError } from "@fe-radar/shared";
import type { EmbeddingRequest, JsonSchemaRequest, LlmClient, LlmResult } from "../types";

export interface ScrubbedBlockResult {
  blocked: true;
  scrub: ScrubResult;
}

export class ScrubbedLlmClient implements LlmClient {
  public constructor(
    private readonly inner: LlmClient,
    private readonly context: ScrubContext = {}
  ) {
    if (process.env.NODE_ENV === "production" && process.env.SCRUBBER_ENABLED === "false") {
      throw new LlmError("SCRUBBER_DISABLED", "Scrubber must be enabled in production");
    }
  }

  public async chatJson<T>(request: JsonSchemaRequest): Promise<LlmResult<T>> {
    const scrub = safeScrub(request.user, this.context);
    if (scrub.level === "block") {
      throw new LlmError("SCRUBBER_BLOCKED", "LLM request blocked by scrubber", scrub.audit);
    }
    return this.inner.chatJson<T>({ ...request, user: scrub.cleaned });
  }

  public async embedding(request: EmbeddingRequest): Promise<LlmResult<number[]>> {
    const scrub = safeScrub(request.input, this.context);
    if (scrub.level === "block") {
      throw new LlmError("SCRUBBER_BLOCKED", "Embedding request blocked by scrubber", scrub.audit);
    }
    return this.inner.embedding({ input: scrub.cleaned });
  }
}

export function withScrubber(client: LlmClient, context?: ScrubContext): LlmClient {
  return new ScrubbedLlmClient(client, context);
}

function safeScrub(input: string, context: ScrubContext): ScrubResult {
  try {
    return scrubText(input, context);
  } catch (error) {
    throw new LlmError("SCRUBBER_FAILED", "Scrubber failed before LLM request", { cause: error });
  }
}
