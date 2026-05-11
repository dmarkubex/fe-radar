import { describe, expect, it } from "vitest";
import { assertRobotsAllowed, clearRobotsCache } from "../robots";

describe("robots guard", () => {
  it("blocks disallowed private path", async () => {
    clearRobotsCache();
    const fetchImpl = async () => new Response("User-agent: *\nDisallow: /private\n");
    await expect(assertRobotsAllowed("https://example.com/private/data", "FE-Radar Bot", fetchImpl as typeof fetch)).rejects.toThrow("disallows");
  });

  it("allows public path", async () => {
    clearRobotsCache();
    const fetchImpl = async () => new Response("User-agent: *\nDisallow: /private\n");
    await expect(assertRobotsAllowed("https://example.com/news", "FE-Radar Bot", fetchImpl as typeof fetch)).resolves.toBeUndefined();
  });
});
