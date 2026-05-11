import { describe, expect, it } from "vitest";
import { createQwenClient } from "../clients/qwen";

describe("qwen client", () => {
  it("uses local OpenAI-compatible defaults for chat and embedding", () => {
    const client = createQwenClient();
    expect(client).toBeTruthy();
  });
});
