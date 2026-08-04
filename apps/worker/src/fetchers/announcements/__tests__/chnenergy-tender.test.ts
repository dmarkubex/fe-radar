import { describe, expect, it } from "vitest";
import {
  parseChnEnergyHtml,
  resolveChnEnergyEndpoint
} from "../chnenergy-tender";

const config = {
  type: "announcement" as const,
  adapter: "chnenergy-tender",
  endpoint: "https://www.chnenergybidding.com.cn/bidweb/",
  keywords: ["电缆", "储能"],
  noticeKinds: ["tender", "candidate", "result"]
};

describe("chnenergy-tender", () => {
  it("enforces the official landing-page endpoint", () => {
    expect(resolveChnEnergyEndpoint(config)).toBe(config.endpoint);
    expect(() =>
      resolveChnEnergyEndpoint({ ...config, endpoint: "https://evil.example/" })
    ).toThrow(/allowlisted/);
  });

  it("extracts the full date from official URLs and separates notice kinds", () => {
    const html = `<ul>
      <li class="tab2-item clearfix"><div><a class="infolink" href="/bidweb/001/001002/001002002/20260803/a.html" title="储能项目公开招标项目招标公告">储能项目公开招标项目招标公告</a></div><span class="tab2-date">08-03</span></li>
      <li class="tab2-item clearfix"><div><a class="infolink" href="/bidweb/001/001005/001005003/20260804/b.html" title="电缆项目中标候选人公示">电缆项目中标候选人公示</a></div><span class="tab2-date">08-04</span></li>
      <li class="tab2-item clearfix"><div><a class="infolink" href="/bidweb/001/001006/001006003/20260804/c.html" title="无关项目中标结果公告">无关项目中标结果公告</a></div></li>
    </ul>`;
    const items = parseChnEnergyHtml(
      html,
      ["电缆", "储能"],
      ["tender", "candidate", "result"]
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.publishedAt.toISOString()).toBe(
      "2026-08-02T16:00:00.000Z"
    );
    expect(items.map((item) => item.content)).toEqual([
      expect.stringContaining("招标公告"),
      expect.stringContaining("候选公示")
    ]);
  });
});
