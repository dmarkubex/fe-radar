import { scrubText, type ScrubContext, type ScrubResult } from "@fe-radar/core";
import { LlmError } from "@fe-radar/shared";
import type {
  ChatMessage,
  ChatStreamDelta,
  ChatStreamRequest,
  EmbeddingRequest,
  JsonSchemaRequest,
  LlmClient,
  LlmResult
} from "../types";

export interface ScrubbedBlockResult {
  blocked: true;
  scrub: ScrubResult;
}

export class ScrubbedLlmClient implements LlmClient {
  public constructor(
    private readonly inner: LlmClient,
    private readonly context: ScrubContext = {}
  ) {
    assertScrubberEnabled();
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

  /**
   * 对 messages 每一条 content（system / user / assistant / tool）scrubText；
   * 任一条 block 即抛两参 LlmError，不调 inner。signal 原样转发。
   */
  public async *chatStream(request: ChatStreamRequest): AsyncIterable<ChatStreamDelta> {
    const messages: ChatMessage[] = [];
    for (const message of request.messages) {
      const scrub = safeScrub(message.content, this.context);
      if (scrub.level === "block") {
        throw new LlmError("SCRUBBER_BLOCKED", "scrubber blocked");
      }
      messages.push({ ...message, content: scrub.cleaned });
    }
    yield* this.inner.chatStream({ ...request, messages });
  }
}

export function withScrubber(client: LlmClient, context?: ScrubContext): LlmClient {
  return new ScrubbedLlmClient(client, context);
}

export function assertScrubberEnabled(): void {
  if (process.env.NODE_ENV === "production" && process.env.SCRUBBER_ENABLED === "false") {
    throw new LlmError("SCRUBBER_DISABLED", "Scrubber must be enabled in production");
  }
}

function safeScrub(input: string, context: ScrubContext): ScrubResult {
  try {
    return scrubText(input, context);
  } catch (error) {
    throw new LlmError("SCRUBBER_FAILED", "Scrubber failed before LLM request", { cause: error });
  }
}
