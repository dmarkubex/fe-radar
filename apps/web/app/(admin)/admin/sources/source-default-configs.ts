export type FetcherType = "rss" | "html" | "playwright" | "quotes" | "announcement" | "crawl";

export const DEFAULT_SOURCE_CATEGORIES: Partial<Record<FetcherType, string>> = {
  announcement: "上市公司涉诉",
  crawl: "风险检索",
  quotes: "行情数据"
};

export const DEFAULT_SOURCE_CONFIGS: Record<FetcherType, unknown> = {
  rss: { type: "rss", url: "https://news.bjx.com.cn/rss.xml" },
  announcement: {
    type: "announcement",
    adapter: "cninfo",
    searchkey: "诉讼",
    titleKeywords: ["诉讼", "仲裁", "判决", "裁定", "涉诉", "起诉", "应诉"],
    litigationFilter: true,
    stocks: ["600973"],
    useRealUa: true,
    pageSize: 30,
    lookbackDays: 14
  },
  html: {
    type: "html",
    listUrl: "https://example.com/news",
    selectors: {
      item: ".news-item",
      title: ".title",
      link: "a",
      date: ".date",
      content: ".content"
    },
    useRealUa: false
  },
  playwright: {
    type: "playwright",
    listUrl: "https://example.com/news",
    waitFor: ".news-list",
    extractor: "() => []",
    useRealUa: true
  },
  quotes: {
    type: "quotes",
    adapter: "smm-hq",
    metric_keys: ["cu_main_close", "cu_spot_smm"],
    endpoint: "https://hq.smm.cn/h5/cu",
    retry: { max: 3, backoffMs: 2000 },
    items: [
      {
        kind: "instrument",
        metric_key: "cu_main_close",
        column_no: "CUP01",
        instrument_id: "cu0000",
        value_field: "LastPrice"
      },
      {
        kind: "product",
        metric_key: "cu_spot_smm",
        column_no: "CUP02",
        product_id: "201102250376",
        product_name: "上海今日铜价"
      }
    ]
  },
  crawl: {
    type: "crawl",
    adapter: "firecrawl",
    queries: ["远东控股 诉讼", "远东电缆 行政处罚"],
    limit: 5,
    country: "CN",
    tbs: "qdr:w",
    riskFilter: true,
    entityKeywords: ["远东控股", "远东电缆", "远东智慧能源", "远东股份", "远东"],
    riskKeywords: [
      "诉讼",
      "仲裁",
      "判决",
      "处罚",
      "罚款",
      "失信",
      "被执行",
      "事故",
      "质量",
      "抽检",
      "不合格",
      "召回",
      "舆情",
      "负面"
    ],
    includeDomains: [
      "news.bjx.com.cn",
      "www.cls.cn",
      "finance.sina.com.cn",
      "www.stcn.com",
      "www.gov.cn",
      "www.nea.gov.cn",
      "www.ndrc.gov.cn",
      "www.miit.gov.cn"
    ]
  }
};
