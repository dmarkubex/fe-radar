import { describe, expect, it } from "vitest";
import {
  buildPowerChinaBody,
  mapPowerChinaResponse,
  resolvePowerChinaEndpoint,
  validatePowerChinaConfig
} from "../powerchina-tender";

const config = {
  type: "announcement" as const,
  adapter: "powerchina-tender",
  endpoint:
    "https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/list",
  keywords: ["电缆", "储能"],
  noticeKinds: ["tender", "purchase", "candidate", "result"],
  pageSize: 20
};

describe("powerchina-tender", () => {
  it("enforces the endpoint and page-size boundary", () => {
    expect(resolvePowerChinaEndpoint(config)).toBe(config.endpoint);
    expect(() =>
      resolvePowerChinaEndpoint({
        ...config,
        endpoint:
          "https://evil.example/newcbs/recpro-newmember/BidAnnouncementSummary/list"
      })
    ).toThrow(/allowlisted/);
    expect(validatePowerChinaConfig({ ...config, pageSize: 7 }).pageSize).toBe(
      7
    );
    expect(() => validatePowerChinaConfig({ ...config, pageSize: 21 })).toThrow(
      /1\.\.20/
    );
  });

  it("distinguishes tender and purchase request bodies", () => {
    expect(buildPowerChinaBody("tender", 20, "电缆", 1)).toMatchObject({
      announcementType: "招采公告",
      bidType: 1,
      keyWords: "电缆",
      time: 1
    });
    expect(buildPowerChinaBody("purchase", 20, "储能", 1)).toMatchObject({
      bidType: 0,
      keyWords: "储能"
    });
  });

  it("maps official rows with real dates and original document URLs", () => {
    const items = mapPowerChinaResponse(
      {
        code: 200,
        rows: [
          {
            id: "2409500094",
            title: "110kV电缆线路工程公开询比采购公告",
            titleTypeName: "工程类",
            publishTime: "2026-08-04 10:00:01",
            pictureUrl:
              "https://bid-zb.powerchina.cn/bidprocurement/common-tools/tools/commonUpload/bulletinDownLoadFile?bizId=x&fileType=2"
          }
        ]
      },
      "purchase"
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.publishedAt.toISOString()).toBe(
      "2026-08-04T02:00:01.000Z"
    );
    expect(items[0]?.url).toMatch(/^https:\/\/bid-zb\.powerchina\.cn\//);
  });
});
