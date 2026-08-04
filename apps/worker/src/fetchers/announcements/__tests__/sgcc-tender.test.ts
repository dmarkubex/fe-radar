import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTextWithPolicy } from "../../http";
import {
  buildSgccTenderBody,
  fetchSgccTender,
  mapSgccTenderResponse,
  resolveSgccTenderEndpoint,
  validateSgccTenderConfig
} from "../sgcc-tender";

vi.mock("../../http", () => ({ fetchTextWithPolicy: vi.fn() }));
const fetchText = vi.mocked(fetchTextWithPolicy);
const config = {
  type: "announcement" as const,
  adapter: "sgcc-tender",
  endpoint: "https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore/index/noteList",
  keywords: ["电缆"],
  noticeKinds: ["tender"],
  pageSize: 20
};

describe("sgcc-tender", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows only the canonical SGCC API and validates config", () => {
    expect(
      resolveSgccTenderEndpoint({
        ...config,
        endpoint: "https://ecp.sgcc.com.cn/ecp2.0//ecpwcmcore/index/noteList"
      })
    ).toBe(config.endpoint);
    expect(() =>
      resolveSgccTenderEndpoint({
        ...config,
        endpoint: "https://evil.example/ecp2.0/ecpwcmcore/index/noteList"
      })
    ).toThrow(/allowlisted/);
    expect(validateSgccTenderConfig({ ...config, pageSize: 7 }).pageSize).toBe(
      7
    );
    expect(() => validateSgccTenderConfig({ ...config, pageSize: 21 })).toThrow(
      /1\.\.20/
    );
  });

  it("builds the observed JSON request shape", () => {
    expect(buildSgccTenderBody("tender", 20, "电缆")).toMatchObject({
      index: 1,
      size: 20,
      firstPageMenuId: "2018032700291334",
      key: "电缆"
    });
  });

  it("maps resultValue.noteList and dedupes numeric document ids", () => {
    const items = mapSgccTenderResponse(
      {
        successful: true,
        resultValue: {
          noteList: [
            {
              firstPageDocId: 123,
              title: "电缆采购",
              publishOrgName: "国家电网",
              noticePublishTime: "2026-05-11 09:30:00"
            },
            {
              firstPageDocId: 123,
              title: "重复",
              noticePublishTime: "2026-05-11"
            }
          ]
        }
      },
      "tender"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toMatch(/doc-com\/123$/);
  });

  it("posts JSON through the policy helper", async () => {
    fetchText.mockResolvedValue(
      JSON.stringify({
        successful: true,
        resultValue: {
          noteList: [
            {
              firstPageDocId: 123,
              title: "电缆采购",
              publishOrgName: "国家电网",
              noticePublishTime: "2026-05-11"
            }
          ]
        }
      })
    );
    const items = await fetchSgccTender(config, { sourceName: "sgcc" });
    expect(items).toHaveLength(1);
    const options = fetchText.mock.calls[0]?.[1];
    expect(options?.init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    expect(JSON.parse(String(options?.init?.body))).toMatchObject({
      firstPageMenuId: "2018032700291334",
      key: "电缆"
    });
  });
});
