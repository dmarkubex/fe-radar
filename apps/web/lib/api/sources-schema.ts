import { z } from "zod";

const tierSchema = z.enum(["T1", "T2", "T3"]);
const fetcherTypeSchema = z.enum([
  "rss",
  "html",
  "playwright",
  "quotes",
  "announcement",
  "crawl"
]);

const quotesAdapterSchema = z.enum([
  "shfe",
  "gfex",
  "lme",
  "pboc",
  "chinabond",
  "rsshub-extract",
  "smm-hq",
  "exchange-api"
]);

const quotesRetrySchema = z.object({
  max: z.number().int().min(1),
  backoffMs: z.number().int().min(0)
});

const quotesRegexRuleSchema = z.object({
  pattern: z.string().min(1),
  metric_key: z.string().min(1),
  unit_multiplier: z.number().positive().optional(),
  group: z.number().int().min(1).optional()
});

const quotesSmmHqItemSchema = z
  .object({
    metric_key: z.string().min(1),
    emit_metric_keys: z.array(z.string().min(1)).optional(),
    kind: z.enum(["product", "instrument"]).optional(),
    column_no: z.string().min(1).optional(),
    product_id: z.string().min(1).optional(),
    product_name: z.string().min(1).optional(),
    product_names: z.array(z.string().min(1)).optional(),
    instrument_id: z.string().min(1).optional(),
    typename: z.string().min(1).optional(),
    value_field: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.column_no), {
    message: "smm-hq item requires column_no",
    path: ["column_no"]
  })
  .refine(
    (value) =>
      value.kind !== "instrument" ||
      Boolean(value.instrument_id || value.typename),
    {
      message: "smm-hq instrument item requires instrument_id or typename",
      path: ["instrument_id"]
    }
  )
  .refine(
    (value) =>
      value.kind === "instrument" ||
      Boolean(
        value.product_id || value.product_name || value.product_names?.length
      ),
    {
      message:
        "smm-hq product item requires product_id, product_name, or product_names",
      path: ["product_id"]
    }
  );

const endpointSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (value.startsWith("/")) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "endpoint must be an absolute URL or a relative path beginning with /"
    }
  );

const quotesConfigSchema = z
  .object({
    type: z.literal("quotes"),
    adapter: quotesAdapterSchema,
    metric_keys: z.array(z.string().min(1)).min(1),
    endpoint: endpointSchema,
    retry: quotesRetrySchema,
    regex_rules: z.array(quotesRegexRuleSchema).optional(),
    items: z.array(quotesSmmHqItemSchema).optional()
  })
  .refine((value) => value.adapter === "smm-hq" || value.items === undefined, {
    message: "quotes items are only valid for smm-hq adapter",
    path: ["items"]
  })
  .refine(
    (value) => value.adapter !== "smm-hq" || Boolean(value.items?.length),
    {
      message: "smm-hq adapter requires items",
      path: ["items"]
    }
  )
  .refine(
    (value) =>
      value.adapter !== "exchange-api" ||
      value.endpoint ===
        "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
    {
      message: "exchange-api endpoint is fixed",
      path: ["endpoint"]
    }
  );

const gate0Schema = z
  .object({
    domains: z
      .array(
        z.enum([
          "own_company",
          "products",
          "industry_policy",
          "competitors",
          "upstream",
          "downstream"
        ])
      )
      .min(1)
      .refine((values) => new Set(values).size === values.length),
    signalKinds: z
      .array(z.enum(["tender"]))
      .min(1)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    maxAgeHours: z.number().int().min(1).max(8760)
  })
  .strict();

export const sourceConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rss"),
    url: z.string().url(),
    keywordFilter: z.array(z.string().min(1)).optional(),
    gate0: gate0Schema.optional()
  }),
  z.object({
    type: z.literal("html"),
    listUrl: z.string().url(),
    insecureTLS: z.boolean().optional(),
    selectors: z.object({
      item: z.string().min(1),
      title: z.string().min(1),
      link: z.string().min(1),
      date: z.string().min(1),
      content: z.string().min(1).optional()
    }),
    useRealUa: z.boolean().optional(),
    keywordFilter: z.array(z.string().min(1)).optional(),
    verificationBlocked: z.boolean().optional(),
    verificationBlockedReason: z.string().min(1).optional(),
    gate0: gate0Schema.optional()
  }),
  z.object({
    type: z.literal("playwright"),
    listUrl: z.string().url(),
    waitFor: z.string().min(1),
    extractor: z.string().startsWith("() =>"),
    useRealUa: z.boolean().optional(),
    verificationBlocked: z.boolean().optional(),
    verificationBlockedReason: z.string().min(1).optional(),
    gate0: gate0Schema.optional()
  }),
  quotesConfigSchema,
  z.object({
    type: z.literal("announcement"),
    adapter: z.enum([
      "cninfo",
      "szse",
      "sse",
      "nea-news",
      "sgcc-tender",
      "powerchina-tender",
      "chnenergy-tender"
    ]),
    searchkey: z.string().min(1).optional(),
    titleKeywords: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    litigationFilter: z.boolean().optional(),
    stock: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    stocks: z.array(z.string().min(1)).optional(),
    stockCode: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    secCode: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    securityCode: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    useRealUa: z.boolean().optional(),
    pageNum: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    lookbackDays: z.number().int().min(1).max(90).optional(),
    beginDate: z.string().min(1).optional(),
    endDate: z.string().min(1).optional(),
    seDate: z.string().min(1).optional(),
    tabName: z.string().min(1).optional(),
    channelCode: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    bigCategoryId: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    companyName: z.string().min(1).optional(),
    bulletinType: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    column: z.string().min(1).optional(),
    plate: z.string().min(1).optional(),
    trade: z.string().min(1).optional(),
    endpoint: z.string().url().optional(),
    keywords: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(20)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    noticeKinds: z
      .array(z.enum(["tender", "purchase", "candidate", "result"]))
      .min(1)
      .max(4)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    gate0: gate0Schema.optional()
  }),
  z.object({
    type: z.literal("crawl"),
    adapter: z.literal("firecrawl"),
    queries: z.array(z.string().min(1)).min(1),
    limit: z.number().int().min(1).max(20).optional(),
    includeDomains: z.array(z.string().min(1)).optional(),
    excludeDomains: z.array(z.string().min(1)).optional(),
    country: z.string().min(2).optional(),
    location: z.string().min(1).optional(),
    tbs: z.string().min(1).optional(),
    riskFilter: z.boolean().optional(),
    entityKeywords: z.array(z.string().min(1)).optional(),
    riskKeywords: z.array(z.string().min(1)).optional(),
    maxContentLength: z.number().int().min(100).max(5000).optional(),
    gate0: gate0Schema.optional()
  })
]);

const sourceBodySchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  fetcherType: fetcherTypeSchema,
  config: sourceConfigSchema,
  tier: tierSchema,
  category: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional()
});

function fetcherMatchesConfig(value: {
  fetcherType?: string;
  config?: { type: string };
}): boolean {
  return (
    !value.fetcherType ||
    !value.config ||
    value.fetcherType === value.config.type
  );
}

function crawlRiskKeywordsConfigured(value: {
  config?: {
    type?: string;
    riskFilter?: boolean;
    entityKeywords?: string[];
    riskKeywords?: string[];
    includeDomains?: string[];
  };
}): boolean {
  if (value.config?.type !== "crawl" || value.config.riskFilter !== true) {
    return true;
  }
  return Boolean(
    value.config.entityKeywords?.length &&
    value.config.riskKeywords?.length &&
    value.config.includeDomains?.length
  );
}

function announcementConfigValid(value: {
  config?: {
    type?: string;
    adapter?: string;
    endpoint?: string;
    litigationFilter?: boolean;
    searchkey?: string;
    titleKeywords?: string | string[];
    keywords?: string[];
    noticeKinds?: string[];
    pageSize?: number;
  };
}): boolean {
  if (value.config?.type !== "announcement") {
    return true;
  }

  if (value.config.litigationFilter === true) {
    const titleKeywords = value.config.titleKeywords;
    const hasTitleKeywords = Array.isArray(titleKeywords)
      ? titleKeywords.length > 0
      : typeof titleKeywords === "string" && titleKeywords.trim().length > 0;
    if (!hasTitleKeywords && !value.config.searchkey?.trim()) {
      return false;
    }
  }

  if (
    value.config.adapter === "sgcc-tender" ||
    value.config.adapter === "powerchina-tender" ||
    value.config.adapter === "chnenergy-tender"
  ) {
    // Mirrors apps/worker/src/fetchers/announcements/sgcc-tender.ts (T-G0-04 worker side).
    // apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
    // sgcc-tender requires endpoint + keywords + noticeKinds as a unit (no fallback to titleKeywords/searchkey).
    if (
      !value.config.endpoint ||
      !value.config.keywords?.length ||
      !value.config.noticeKinds?.length ||
      (value.config.adapter !== "chnenergy-tender" &&
        value.config.pageSize !== undefined &&
        value.config.pageSize > 20)
    ) {
      return false;
    }
  }

  if (!value.config.endpoint) {
    return true;
  }

  try {
    const endpoint = new URL(value.config.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      return false;
    }
    if (value.config.adapter === "cninfo") {
      // Keep in sync with apps/worker/src/fetchers/announcements/cninfo.ts resolveCninfoEndpoint.
      // apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
      // Constraints (all must hold): protocol already limited to http:/https: above (NOT https-only —
      // DEFAULT_ENDPOINT and seed configs are http://; forcing https would break the live T1 CNINFO
      // source), hostname www.cninfo.com.cn, path exact match, port empty (default 80/443 only —
      // non-default ports are a different origin), username/password empty (Node/Undici fetch throws
      // on credentialed URLs and would be mis-wrapped as FETCH_TIMEOUT by the worker retry loop).
      // query/hash are intentionally unrestricted: they do not change the request destination.
      return (
        endpoint.hostname === "www.cninfo.com.cn" &&
        endpoint.pathname === "/new/hisAnnouncement/query" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === ""
      );
    }
    if (value.config.adapter === "szse") {
      // Keep in sync with apps/worker/src/fetchers/announcements/szse.ts resolveSzseEndpoint.
      // apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
      // Constraints (all must hold): protocol already limited to http:/https: above (NOT https-only —
      // DEFAULT_ENDPOINT and seed configs are http://; forcing https would break the live T1 SZSE
      // source), hostname www.szse.cn, path exact match, port empty (default 80/443 only —
      // non-default ports are a different origin), username/password empty (Node/Undici fetch throws
      // on credentialed URLs and would be mis-wrapped as FETCH_TIMEOUT by the worker retry loop).
      // query/hash are intentionally unrestricted: they do not change the request destination.
      return (
        endpoint.hostname === "www.szse.cn" &&
        endpoint.pathname === "/api/disc/announcement/annList" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === ""
      );
    }
    if (value.config.adapter === "sse") {
      // Keep in sync with apps/worker/src/fetchers/announcements/sse.ts validateSseEndpoint.
      // apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
      // Constraints (all must hold): protocol already limited to http:/https: above (NOT https-only —
      // DEFAULT_ENDPOINT and seed configs are http://; forcing https would break the live T1 SSE
      // source), hostname query.sse.com.cn, path exact match, port empty (default 80/443 only —
      // non-default ports are a different origin), username/password empty (Node/Undici fetch throws
      // on credentialed URLs and would be mis-wrapped as FETCH_TIMEOUT by the worker retry loop).
      // query/hash are intentionally unrestricted: they do not change the request destination.
      return (
        endpoint.hostname === "query.sse.com.cn" &&
        endpoint.pathname === "/security/stock/queryCompanyBulletin.do" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === ""
      );
    }
    if (value.config.adapter === "nea-news") {
      // Keep in sync with apps/worker/src/fetchers/announcements/nea-news.ts resolveNeaNewsEndpoint.
      // apps/web and apps/worker must not import each other, so the allowlist rules are duplicated on purpose.
      // Only the path shape is relaxed (upstream republish changes the content hash); protocol,
      // hostname, port, and credentials stay strict (SSRF / fetch-safety boundary).
      // Constraints (all must hold): protocol https:, hostname www.nea.gov.cn, path matches
      // NEA_ALLOWED_PATH, port empty (default 443 only — non-default ports are a different origin),
      // username/password empty (Node fetch throws on credentialed URLs and would be mis-wrapped as
      // FETCH_TIMEOUT by the worker retry loop). query/hash are intentionally unrestricted: they do
      // not change the request destination (host/port/path), are not an SSRF surface, and upstream
      // may add cache-busting params later.
      const NEA_ALLOWED_PATH = /^\/xwzx\/ds_[0-9a-f]{32}\.json$/;
      return (
        endpoint.protocol === "https:" &&
        endpoint.hostname === "www.nea.gov.cn" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        NEA_ALLOWED_PATH.test(endpoint.pathname)
      );
    }
    if (value.config.adapter === "sgcc-tender") {
      // Mirrors apps/worker/src/fetchers/announcements/sgcc-tender.ts (T-G0-04 worker side).
      // Constraints (all must hold): protocol https:, hostname ecp.sgcc.com.cn, port empty,
      // username/password empty (same fetch-safety boundary as cninfo/szse/sse),
      // search/hash empty (would change the request destination or carry credentials),
      // pathname normalized by collapsing repeated slashes equals the canonical SGCC noteList path.
      // query is intentionally unrestricted: noticeKinds/keywords/pageNo are POST body or query params
      // and do not change the request destination (host/port/path).
      // URL.pathname does NOT collapse internal repeated slashes; we collapse /+ → / before comparing.
      const normalizedPath = endpoint.pathname.replace(/\/+/g, "/");
      return (
        endpoint.protocol === "https:" &&
        endpoint.hostname === "ecp.sgcc.com.cn" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        normalizedPath === "/ecp2.0/ecpwcmcore/index/noteList"
      );
    }
    if (value.config.adapter === "powerchina-tender") {
      return (
        endpoint.protocol === "https:" &&
        endpoint.hostname === "bid.powerchina.cn" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        endpoint.pathname ===
          "/newcbs/recpro-newmember/BidAnnouncementSummary/list"
      );
    }
    if (value.config.adapter === "chnenergy-tender") {
      return (
        endpoint.protocol === "https:" &&
        endpoint.hostname === "www.chnenergybidding.com.cn" &&
        endpoint.port === "" &&
        endpoint.username === "" &&
        endpoint.password === "" &&
        endpoint.search === "" &&
        endpoint.hash === "" &&
        endpoint.pathname === "/bidweb/"
      );
    }
    return false;
  } catch {
    return false;
  }
}

export const createSourceSchema = sourceBodySchema
  .refine(fetcherMatchesConfig, {
    message: "fetcherType must match config.type",
    path: ["fetcherType"]
  })
  .refine(crawlRiskKeywordsConfigured, {
    message:
      "crawl riskFilter requires entityKeywords, riskKeywords, and includeDomains",
    path: ["config", "entityKeywords"]
  })
  .refine(announcementConfigValid, {
    message:
      "announcement config requires allowed endpoint and litigation keywords",
    path: ["config", "endpoint"]
  });

export const updateSourceSchema = sourceBodySchema
  .partial()
  .refine(fetcherMatchesConfig, {
    message: "fetcherType must match config.type",
    path: ["fetcherType"]
  })
  .refine(crawlRiskKeywordsConfigured, {
    message:
      "crawl riskFilter requires entityKeywords, riskKeywords, and includeDomains",
    path: ["config", "entityKeywords"]
  })
  .refine(announcementConfigValid, {
    message:
      "announcement config requires allowed endpoint and litigation keywords",
    path: ["config", "endpoint"]
  });

export function validationError(details: unknown): Response {
  return Response.json(
    { error: { code: "VALIDATION", message: "参数校验失败", details } },
    { status: 400 }
  );
}
