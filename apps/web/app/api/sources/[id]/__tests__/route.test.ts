import { beforeEach, describe, expect, it, vi } from "vitest";

const { DuplicateEnabledSourceError, ProtectedSourceUrlError, mockUpdateSource, mockRequireRequestRole } = vi.hoisted(() => {
  class DuplicateEnabledSourceError extends Error {
    public readonly code = "SOURCE_DUPLICATE_ENABLED";

    public constructor(public readonly conflictingId: number) {
      super(`同组已有启用的 URL 锁定信源 #${conflictingId}，启用此信源会造成双重抓取，请先停用另一行`);
    }
  }

  class ProtectedSourceUrlError extends Error {
    public readonly code = "SOURCE_URL_PROTECTED";

    public constructor() {
      super("该信源是行情数据 seed 源，URL 变更会被部署时的 migration 覆盖并造成重复行，请勿修改");
    }
  }

  return {
    DuplicateEnabledSourceError,
    ProtectedSourceUrlError,
    mockUpdateSource: vi.fn(),
    mockRequireRequestRole: vi.fn(async (): Promise<Response | null> => null)
  };
});

vi.mock("@fe-radar/db", () => ({
  DuplicateEnabledSourceError,
  getDb: vi.fn(() => ({})),
  ProtectedSourceUrlError,
  softDeleteSource: vi.fn(),
  updateSource: mockUpdateSource
}));
vi.mock("@/lib/api/authz", () => ({ requireRequestRole: mockRequireRequestRole }));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: vi.fn(() => false) }));
vi.mock("@/lib/api/mock-readonly", () => ({ mockReadonlyResponse: vi.fn() }));

import { PUT } from "../route";
import type { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRequestRole.mockResolvedValue(null);
});

describe("PUT /api/sources/[id]", () => {
  it("returns 400 when a protected seed URL is changed", async () => {
    mockUpdateSource.mockRejectedValue(new ProtectedSourceUrlError());
    const request = new Request("http://localhost/api/sources/7", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/cu" })
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ id: "7" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "SOURCE_URL_PROTECTED",
        message: "该信源是行情数据 seed 源，URL 变更会被部署时的 migration 覆盖并造成重复行，请勿修改"
      }
    });
  });

  it("returns 400 when the locked source group already has an enabled sibling", async () => {
    mockUpdateSource.mockRejectedValue(new DuplicateEnabledSourceError(3));
    const request = new Request("http://localhost/api/sources/7", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true })
    }) as NextRequest;

    const response = await PUT(request, { params: Promise.resolve({ id: "7" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "SOURCE_DUPLICATE_ENABLED",
        message: "同组已有启用的 URL 锁定信源 #3，启用此信源会造成双重抓取，请先停用另一行"
      }
    });
  });
});
