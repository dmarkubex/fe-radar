import { describe, expect, it } from "vitest";
import {
  createSourceSchema,
  sourceConfigSchema
} from "../../../../lib/api/sources-schema";

describe("sources api schema", () => {
  it("accepts matching rss source", () => {
    expect(
      createSourceSchema.safeParse({
        name: "北极星电力新闻网",
        url: "https://news.bjx.com.cn/rss.xml",
        fetcherType: "rss",
        tier: "T2",
        config: { type: "rss", url: "https://news.bjx.com.cn/rss.xml" }
      }).success
    ).toBe(true);
  });

  it("preserves RSS keyword filters through validation", () => {
    const parsed = createSourceSchema.parse({
      name: "财经全站源",
      url: "https://example.com/rss.xml",
      fetcherType: "rss",
      tier: "T3",
      config: {
        type: "rss",
        url: "https://example.com/rss.xml",
        keywordFilter: ["电缆", "光纤"]
      }
    });
    expect(parsed.config).toMatchObject({
      keywordFilter: ["电缆", "光纤"]
    });
  });

  it("preserves HTML keyword filters through validation", () => {
    expect(
      sourceConfigSchema.parse({
        type: "html",
        listUrl: "https://finance.ifeng.com/",
        selectors: { item: "a", title: "a", link: "a", date: "span" },
        keywordFilter: ["储能", "光纤"]
      })
    ).toMatchObject({ keywordFilter: ["储能", "光纤"] });
  });

  it("preserves compliance verification blocks for HTML and Playwright sources", () => {
    const configs = [
      {
        type: "html",
        listUrl: "https://example.com/news",
        selectors: { item: "li", title: "a", link: "a", date: "time" },
        verificationBlocked: true,
        verificationBlockedReason: "robots.txt explicitly disallows target path"
      },
      {
        type: "playwright",
        listUrl: "https://example.com/news",
        waitFor: "body",
        itemSelector: "a",
        verificationBlocked: true,
        verificationBlockedReason: "robots.txt explicitly disallows target path"
      }
    ];

    for (const config of configs) {
      expect(sourceConfigSchema.parse(config)).toMatchObject({
        verificationBlocked: true,
        verificationBlockedReason: "robots.txt explicitly disallows target path"
      });
    }
  });

  it("rejects mismatched fetcher type and config", () => {
    expect(
      createSourceSchema.safeParse({
        name: "bad",
        url: "https://example.com",
        fetcherType: "rss",
        tier: "T2",
        config: {
          type: "html",
          listUrl: "https://example.com",
          selectors: { item: ".i", title: ".t", link: "a", date: ".d" }
        }
      }).success
    ).toBe(false);
  });

  it("accepts html insecureTLS config and preserves it", () => {
    const result = createSourceSchema.safeParse({
      name: "电缆网 cableabc",
      url: "https://www.cableabc.com/news/",
      fetcherType: "html",
      tier: "T2",
      category: "媒体-垂直",
      config: {
        type: "html",
        listUrl: "https://www.cableabc.com/news/",
        insecureTLS: true,
        selectors: { item: "li", title: "a", link: "a", date: "span" }
      }
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.config : null).toMatchObject({
      type: "html",
      insecureTLS: true
    });
  });

  it("accepts quotes config with snake_case regex rules and relative endpoint", () => {
    const result = createSourceSchema.safeParse({
      name: "RSSHub 数值抽取-SMM 铜",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 },
        regex_rules: [
          {
            pattern: "(?:现货|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
            metric_key: "cu_spot_smm",
            unit_multiplier: 1,
            group: 1
          }
        ]
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects legacy regex rule key naming", () => {
    const result = createSourceSchema.safeParse({
      name: "legacy",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 },
        regex_rules: [{ pattern: "(\\d+)", key: "cu_spot_smm" }]
      }
    });

    expect(result.success).toBe(false);
  });

  // T-SEC-10: 编辑员提交的报价正则在 Worker 同步执行，拒绝灾难性回溯构造。
  it("rejects ReDoS-prone regex patterns (nested unbounded quantifiers) but accepts normal numeric patterns", () => {
    const base = {
      name: "redos",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 }
      }
    };

    // 正常数值模式应通过。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(?:现货|报价)[^\\d]*(\\d+(?:\\.\\d+)?)", metric_key: "cu_spot_smm", group: 1 }] }
    }).success).toBe(true);

    // 灾难性嵌套量词 (a+)+ 应拒绝。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(\\d+)+", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(a*)*", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);

    // S8: 组内无界量词 + 组外有界重复 (a+){2,} 同样指数回溯，必须拒绝。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(a+){2,}", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(a+){25}", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);
    // 正常数值模式 ([0-9.]+)\s*元/吨 不受影响。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "([0-9.]+)\\s*元/吨", metric_key: "cu_spot_smm" }] }
    }).success).toBe(true);

    // 语法错拒绝。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "(\\d", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);

    // 复核 F10 / HIGH-6: 重叠交替 ^(a|aa)+$ 必须拒绝（静态 lint 补的家族）。
    // 注意：不在此跑执行探针（HIGH-6：探针会挂死事件循环）。
    expect(createSourceSchema.safeParse({
      ...base,
      config: { ...base.config, regex_rules: [{ pattern: "^(a|aa)+$", metric_key: "cu_spot_smm" }] }
    }).success).toBe(false);
  });

  // S8-fix (C-1): 相邻同基无界量词家族（无括号）—— a+a+a+a+ / [0-9]+[0-9]+ 等。
  // 修复前 ^a+a+a+a+a+a+a+a+a+a+$ 会通过（无检测器命中）；修复后必须拒绝。
  it("S8-fix: rejects adjacent same-base unbounded quantifiers, allows real business regex", () => {
    const base = {
      name: "redos-fix",
      url: "http://rsshub:1200/smm/news/cu",
      fetcherType: "quotes",
      tier: "T2",
      config: {
        type: "quotes",
        adapter: "rsshub-extract",
        metric_keys: ["cu_spot_smm"],
        endpoint: "/smm/news/cu",
        retry: { max: 2, backoffMs: 1000 }
      }
    };

    // 拒绝组：全部必须被 isSafeRegex 拒绝。
    const mustReject = [
      "^a+a+a+a+a+a+a+a+a+a+$",   // 修复前通过 ← C-1 核心 gap
      "a+a+a+b",
      "(a+){2,}",                    // 已有检测器覆盖，不得回退
      "(a+){25}",
      "(x+x+)+y",
      "(a|aa)+$",
      "[0-9]+[0-9]+[0-9]+x",
    ];
    for (const pattern of mustReject) {
      expect(createSourceSchema.safeParse({
        ...base,
        config: { ...base.config, regex_rules: [{ pattern, metric_key: "cu_spot_smm" }] }
      }).success).toBe(false);
    }

    // 放行组：真实业务正则（0009_commodity_seed.sql），含 3 个无界量词也不误伤。
    const mustAllow = [
      "([0-9.]+)\\s*元/吨",
      "价格[:：]\\s*([\\d,]+)",
      "LME铜\\s*([0-9]+\\.?[0-9]*)",
      "收盘价\\s*(\\d{4,6})",
    ];
    for (const pattern of mustAllow) {
      expect(createSourceSchema.safeParse({
        ...base,
        config: { ...base.config, regex_rules: [{ pattern, metric_key: "cu_spot_smm" }] }
      }).success).toBe(true);
    }
  });

  // S8 (C-2): 生产 seed 0022/0023 的 html 信源 date:"" 必须通过校验。
  // worker html.ts 显式支持 date:"" 回退抓取时间；schema 此前 min(1) 锁死 8 个源无法保存。
  it("accepts real bjx seed config from migration 0022 with empty date selector", () => {
    const result = createSourceSchema.safeParse({
      name: "北极星电力网",
      url: "https://www.bjx.com.cn/",
      fetcherType: "html",
      tier: "T2",
      category: "媒体-垂直",
      config: {
        type: "html",
        listUrl: "https://www.bjx.com.cn/",
        useRealUa: true,
        selectors: {
          item: ".cc-ul-dot li a[href*=\"news.bjx.com.cn/html\"]",
          title: "a",
          link: "a",
          date: ""
        }
      }
    });
    expect(result.success).toBe(true);
  });

  it("accepts SMM HQ quotes config with item selectors and aliases", () => {
    const result = createSourceSchema.safeParse({
      name: "SMM 碳酸锂行情",
      url: "https://hq.smm.cn/h5/Li2CO3",
      fetcherType: "quotes",
      tier: "T1",
      config: {
        type: "quotes",
        adapter: "smm-hq",
        metric_keys: ["lc_main_close", "lc_spot_smm"],
        endpoint: "https://hq.smm.cn/h5/Li2CO3",
        retry: { max: 3, backoffMs: 2000 },
        items: [
          {
            kind: "product",
            metric_key: "lc_main_close",
            emit_metric_keys: ["lc_spot_smm"],
            column_no: "LCP02",
            product_id: "201102250059",
            product_name: "电池级碳酸锂价格"
          }
        ]
      }
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.config : null).toMatchObject({
      type: "quotes",
      adapter: "smm-hq",
      items: [{ metric_key: "lc_main_close" }]
    });
  });

  it("rejects SMM HQ items on non-SMM quotes adapters", () => {
    const result = createSourceSchema.safeParse({
      name: "bad quotes",
      url: "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat",
      fetcherType: "quotes",
      tier: "T1",
      config: {
        type: "quotes",
        adapter: "shfe",
        metric_keys: ["cu_main_close"],
        endpoint: "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat",
        retry: { max: 3, backoffMs: 2000 },
        items: [{ metric_key: "cu_main_close", column_no: "CUP01" }]
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects under-specified SMM HQ items", () => {
    const result = createSourceSchema.safeParse({
      name: "bad SMM",
      url: "https://hq.smm.cn/h5/cu",
      fetcherType: "quotes",
      tier: "T1",
      config: {
        type: "quotes",
        adapter: "smm-hq",
        metric_keys: ["cu_main_close"],
        endpoint: "https://hq.smm.cn/h5/cu",
        retry: { max: 3, backoffMs: 2000 },
        items: [{ metric_key: "cu_main_close" }]
      }
    });

    expect(result.success).toBe(false);
  });

  it("accepts crawl config for firecrawl risk search", () => {
    expect(
      createSourceSchema.safeParse({
        name: "Firecrawl-C1风险检索",
        url: "https://internal.fe-radar/crawl/c1-risk",
        fetcherType: "crawl",
        tier: "T2",
        category: "风险检索",
        config: {
          type: "crawl",
          adapter: "firecrawl",
          queries: ["远东控股 诉讼"],
          limit: 5,
          riskFilter: true,
          entityKeywords: ["远东控股"],
          riskKeywords: ["诉讼"],
          includeDomains: ["www.gov.cn"]
        }
      }).success
    ).toBe(true);
  });

  it("accepts crawl config without riskFilter when keywords are omitted", () => {
    expect(
      createSourceSchema.safeParse({
        name: "Firecrawl-通用检索",
        url: "https://internal.fe-radar/crawl/generic",
        fetcherType: "crawl",
        tier: "T2",
        config: {
          type: "crawl",
          adapter: "firecrawl",
          queries: ["电线电缆 政策"],
          limit: 5,
          includeDomains: ["www.gov.cn"]
        }
      }).success
    ).toBe(true);
  });

  it("rejects risk-filtered crawl config without database keywords", () => {
    expect(
      createSourceSchema.safeParse({
        name: "Firecrawl-C1风险检索",
        url: "https://internal.fe-radar/crawl/c1-risk",
        fetcherType: "crawl",
        tier: "T2",
        category: "风险检索",
        config: {
          type: "crawl",
          adapter: "firecrawl",
          queries: ["远东控股 诉讼"],
          limit: 5,
          riskFilter: true
        }
      }).success
    ).toBe(false);
  });

  it("rejects risk-filtered crawl config without include domains", () => {
    expect(
      createSourceSchema.safeParse({
        name: "Firecrawl-C1风险检索",
        url: "https://internal.fe-radar/crawl/c1-risk",
        fetcherType: "crawl",
        tier: "T2",
        category: "风险检索",
        config: {
          type: "crawl",
          adapter: "firecrawl",
          queries: ["远东控股 诉讼"],
          limit: 5,
          riskFilter: true,
          entityKeywords: ["远东控股"],
          riskKeywords: ["诉讼"]
        }
      }).success
    ).toBe(false);
  });

  it("accepts announcement config for litigation sources", () => {
    expect(
      createSourceSchema.safeParse({
        name: "深交所公告-竞品涉诉",
        url: "https://www.szse.cn/disclosure/listed/notice/index.html",
        fetcherType: "announcement",
        tier: "T1",
        category: "上市公司涉诉",
        config: {
          type: "announcement",
          adapter: "szse",
          litigationFilter: true,
          titleKeywords: ["诉讼", "仲裁"],
          stocks: ["000533"],
          pageSize: 50
        }
      }).success
    ).toBe(true);
  });

  it("accepts the allowlisted National Energy Administration news feed", () => {
    expect(
      createSourceSchema.safeParse({
        name: "国家能源局",
        url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
        fetcherType: "announcement",
        tier: "T1",
        category: "政府",
        config: {
          type: "announcement",
          adapter: "nea-news",
          endpoint:
            "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
          pageSize: 50,
          useRealUa: true
        }
      }).success
    ).toBe(true);
  });

  it("accepts a republished NEA endpoint with a different 32-hex content hash", () => {
    expect(
      createSourceSchema.safeParse({
        name: "国家能源局",
        url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
        fetcherType: "announcement",
        tier: "T1",
        category: "政府",
        config: {
          type: "announcement",
          adapter: "nea-news",
          endpoint:
            "https://www.nea.gov.cn/xwzx/ds_a1b2c3d4e5f6789012345678abcdef01.json",
          pageSize: 50,
          useRealUa: true
        }
      }).success
    ).toBe(true);
  });

  it("rejects NEA endpoints that break path shape, host, or protocol", () => {
    const base = {
      name: "国家能源局",
      url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
      fetcherType: "announcement" as const,
      tier: "T1" as const,
      category: "政府",
      config: {
        type: "announcement" as const,
        adapter: "nea-news" as const,
        pageSize: 50,
        useRealUa: true
      }
    };

    // wrong path shape (not ds_<32hex>.json)
    expect(
      createSourceSchema.safeParse({
        ...base,
        config: {
          ...base.config,
          endpoint: "https://www.nea.gov.cn/xwzx/ds_short.json"
        }
      }).success
    ).toBe(false);

    // wrong directory
    expect(
      createSourceSchema.safeParse({
        ...base,
        config: {
          ...base.config,
          endpoint:
            "https://www.nea.gov.cn/other/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
        }
      }).success
    ).toBe(false);

    // wrong host (SSRF boundary)
    expect(
      createSourceSchema.safeParse({
        ...base,
        config: {
          ...base.config,
          endpoint:
            "https://evil.example/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
        }
      }).success
    ).toBe(false);

    // http: rejected (SSRF boundary — protocol must stay https:)
    expect(
      createSourceSchema.safeParse({
        ...base,
        config: {
          ...base.config,
          endpoint:
            "http://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
        }
      }).success
    ).toBe(false);
  });

  it("rejects NEA endpoints with non-default port or embedded credentials", () => {
    const base = {
      name: "国家能源局",
      url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
      fetcherType: "announcement" as const,
      tier: "T1" as const,
      category: "政府",
      config: {
        type: "announcement" as const,
        adapter: "nea-news" as const,
        pageSize: 50,
        useRealUa: true
      }
    };

    // non-default port — different origin on the same host
    for (const endpoint of [
      "https://www.nea.gov.cn:444/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "https://www.nea.gov.cn:8443/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
    ]) {
      expect(
        createSourceSchema.safeParse({
          ...base,
          config: { ...base.config, endpoint }
        }).success
      ).toBe(false);
    }

    // embedded credentials — Node fetch cannot construct these URLs
    for (const endpoint of [
      "https://user:pass@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "https://user@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      // password-only: username="" password="pass" — must hit password !== "" clause
      "https://:pass@www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json"
    ]) {
      expect(
        createSourceSchema.safeParse({
          ...base,
          config: { ...base.config, endpoint }
        }).success
      ).toBe(false);
    }
  });

  it("accepts NEA endpoints with optional query/hash on the default port", () => {
    // query/hash do not change host/port/path destination; intentionally allowed.
    expect(
      createSourceSchema.safeParse({
        name: "国家能源局",
        url: "https://www.nea.gov.cn/xwzx/nyyw.htm",
        fetcherType: "announcement",
        tier: "T1",
        category: "政府",
        config: {
          type: "announcement",
          adapter: "nea-news",
          endpoint:
            "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json?v=1#frag",
          pageSize: 50,
          useRealUa: true
        }
      }).success
    ).toBe(true);
  });

  it("rejects announcement config with an unapproved endpoint", () => {
    expect(
      createSourceSchema.safeParse({
        name: "bad announcement",
        url: "https://example.com/source",
        fetcherType: "announcement",
        tier: "T2",
        category: "上市公司涉诉",
        config: {
          type: "announcement",
          adapter: "szse",
          litigationFilter: true,
          titleKeywords: ["诉讼"],
          endpoint: "http://169.254.169.254/latest/meta-data"
        }
      }).success
    ).toBe(false);
  });

  it("accepts seed http:// endpoints for cninfo/szse/sse (must NOT force https)", () => {
    // DEFAULT_ENDPOINT and seed configs are http://; forcing https would break live T1 sources.
    const cases = [
      {
        adapter: "cninfo" as const,
        url: "http://www.cninfo.com.cn/new/disclosure",
        endpoint: "http://www.cninfo.com.cn/new/hisAnnouncement/query"
      },
      {
        adapter: "szse" as const,
        url: "http://www.szse.cn/disclosure/listed/notice/index.html",
        endpoint: "http://www.szse.cn/api/disc/announcement/annList"
      },
      {
        adapter: "sse" as const,
        url: "http://www.sse.com.cn/disclosure/bulletin/company/",
        endpoint: "http://query.sse.com.cn/security/stock/queryCompanyBulletin.do"
      }
    ];

    for (const c of cases) {
      expect(
        createSourceSchema.safeParse({
          name: `seed ${c.adapter}`,
          url: c.url,
          fetcherType: "announcement",
          tier: "T1",
          category: "上市公司公告",
          config: {
            type: "announcement",
            adapter: c.adapter,
            endpoint: c.endpoint
          }
        }).success
      ).toBe(true);
    }
  });

  it("rejects cninfo/szse/sse endpoints with non-default port, credentials, or non-http(s) protocol", () => {
    const adapters = [
      {
        adapter: "cninfo" as const,
        url: "http://www.cninfo.com.cn/new/disclosure",
        path: "/new/hisAnnouncement/query",
        host: "www.cninfo.com.cn"
      },
      {
        adapter: "szse" as const,
        url: "http://www.szse.cn/disclosure/listed/notice/index.html",
        path: "/api/disc/announcement/annList",
        host: "www.szse.cn"
      },
      {
        adapter: "sse" as const,
        url: "http://www.sse.com.cn/disclosure/bulletin/company/",
        path: "/security/stock/queryCompanyBulletin.do",
        host: "query.sse.com.cn"
      }
    ];

    for (const a of adapters) {
      const base = {
        name: `gate ${a.adapter}`,
        url: a.url,
        fetcherType: "announcement" as const,
        tier: "T1" as const,
        category: "上市公司公告",
        config: {
          type: "announcement" as const,
          adapter: a.adapter
        }
      };

      for (const endpoint of [
        `http://${a.host}:8080${a.path}`,
        `http://u:p@${a.host}${a.path}`,
        `http://u@${a.host}${a.path}`,
        // password-only: username="" password="pass" — must hit password !== "" clause
        `http://:pass@${a.host}${a.path}`,
        `file://${a.host}${a.path}`,
        `http://evil.example${a.path}`,
        `http://${a.host}/wrong/path`
      ]) {
        expect(
          createSourceSchema.safeParse({
            ...base,
            config: { ...base.config, endpoint }
          }).success
        ).toBe(false);
      }

      // https on default port remains allowed (upgrade path without forcing it)
      expect(
        createSourceSchema.safeParse({
          ...base,
          config: {
            ...base.config,
            endpoint: `https://${a.host}${a.path}`
          }
        }).success
      ).toBe(true);
    }
  });
});
