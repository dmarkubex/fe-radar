import type { ItemDetailDto } from "@/lib/api/timeline-query";

type MirofishSeedResponse = {
  success?: boolean;
  data?: {
    project_id?: string;
    project_name?: string;
  };
  error?: string;
  message?: string;
};

export class MirofishConfigError extends Error {}
export class MirofishRequestError extends Error {}

export type MirofishSeedPayload = {
  project_name: string;
  simulation_requirement: string;
  additional_context: string;
  documents: Array<{
    filename: string;
    content: string;
    mime_type: "text/markdown";
    source_url: string | null;
  }>;
  metadata: {
    source_system: "fe-radar";
    item_id: number;
    source_url: string | null;
    source_name: string;
    source_tier: string;
    source_category: string | null;
    source_fetcher_type: string | null;
    category: string | null;
    top_circle: string | null;
    alert_type: string | null;
    alert_level: string | null;
    quality_score: number | null;
    related_count: number;
  };
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getMirofishConfig(): {
  apiBaseUrl: string;
  webBaseUrl: string;
  timeoutMs: number;
} {
  if (process.env["MIROFISH_ENABLED"] === "false") {
    throw new MirofishConfigError("MiroFish 联动未启用");
  }

  const localDefault = process.env["NODE_ENV"] === "production" ? "" : "http://127.0.0.1";
  const apiBaseUrl = process.env["MIROFISH_API_BASE_URL"] ?? (localDefault ? `${localDefault}:5001` : "");
  const webBaseUrl = process.env["MIROFISH_WEB_BASE_URL"] ?? (localDefault ? `${localDefault}:3000` : "");
  const timeoutMs = Number(process.env["MIROFISH_REQUEST_TIMEOUT_MS"] ?? 300000);

  if (!apiBaseUrl || !webBaseUrl) {
    throw new MirofishConfigError("缺少 MIROFISH_API_BASE_URL 或 MIROFISH_WEB_BASE_URL");
  }

  return {
    apiBaseUrl: trimTrailingSlash(apiBaseUrl),
    webBaseUrl: trimTrailingSlash(webBaseUrl),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000
  };
}

function clip(value: string | null | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n\n[内容已截断]` : value;
}

function line(label: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "" : `- ${label}: ${value}`;
}

export function buildMirofishSimulationRequirement(
  item: ItemDetailDto,
  userRequirement?: string | null
): string {
  const trimmed = userRequirement?.trim();
  if (trimmed) {
    // 用户给定的推演方向/观点优先，仅追加价格合规约束。
    return [trimmed, "不要给出具体未来价格数值、交易建议或投资意见。"].join("\n");
  }
  return [
    `基于 FE-Radar 情报条目「${item.title}」及其关联事件，推演未来 72 小时内相关主体、产业链、市场舆论与业务风险的可能演化。`,
    "重点输出影响路径、关键触发因素、风险信号、利益相关方反应和后续观察点。",
    "不要给出具体未来价格数值、交易建议或投资意见。"
  ].join("\n");
}

export function buildMirofishSeedMarkdown(item: ItemDetailDto, userRequirement?: string | null): string {
  const scores = item.scores;
  const entities = item.entities.length
    ? item.entities
        .map((entity) =>
          `- ${entityType(entity.type)}: ${entity.canonicalName}${entity.circle ? ` (${entity.circle})` : ""}${entity.span ? `; 命中文本: ${entity.span}` : ""}`
        )
        .join("\n")
    : "- 暂无实体";
  const related = item.clusterItems.length
    ? item.clusterItems
        .slice(0, 12)
        .map((relatedItem) => {
          const url = relatedItem.displayUrl ?? relatedItem.url;
          return `- ${relatedItem.title}（${relatedItem.sourceName}，${relatedItem.publishedAt}）${url ? `\n  ${url}` : ""}`;
        })
        .join("\n")
    : "- 暂无关联条目";

  return [
    "# FE-Radar 情报预测种子",
    "",
    "## 模拟需求",
    buildMirofishSimulationRequirement(item, userRequirement),
    "",
    "## 主条目",
    line("FE-Radar item_id", item.id),
    line("标题", item.title),
    line("信源", `${item.sourceName} / ${item.sourceTier}`),
    line("分类", item.category),
    line("关注圈", item.topCircle),
    line("事件类型", item.eventType),
    line("告警类型", item.alertType),
    line("告警级别", item.alertLevel),
    line("发布时间", item.publishedAt),
    line("评分时间", item.scoredAt),
    line("原文链接", item.displayUrl ?? item.url),
    "",
    "## 五维评分",
    line("综合评分", item.qualityScore),
    line("D1 政策法规", scores.d1Policy),
    line("D2 产业链关联", scores.d2Chain),
    line("D3 市场价格", scores.d3Market),
    line("D4 技术标准", scores.d4Tech),
    line("D5 商业机会", scores.d5Business),
    "",
    "## 摘要",
    clip(item.summaryZh, 4000) || "暂无摘要",
    "",
    "## 中文翻译",
    clip(item.translationZh, 6000) || "暂无翻译",
    "",
    "## 原文内容",
    clip(item.content, 16000) || "暂无原文内容",
    "",
    "## 识别实体",
    entities,
    "",
    "## 关联条目",
    related,
    ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMirofishSeedPayload(
  item: ItemDetailDto,
  userRequirement?: string | null
): MirofishSeedPayload {
  const sourceUrl = item.displayUrl ?? item.url ?? null;
  return {
    project_name: `FE-Radar #${item.id} ${item.title}`.slice(0, 120),
    simulation_requirement: buildMirofishSimulationRequirement(item, userRequirement),
    additional_context: "来源：FE-Radar 产业情报雷达。该种子材料由单条情报及其聚簇关联条目自动生成。",
    documents: [
      {
        filename: `fe-radar-item-${item.id}.md`,
        content: buildMirofishSeedMarkdown(item, userRequirement),
        mime_type: "text/markdown",
        source_url: sourceUrl
      }
    ],
    metadata: {
      source_system: "fe-radar",
      item_id: item.id,
      source_url: sourceUrl,
      source_name: item.sourceName,
      source_tier: item.sourceTier,
      source_category: item.sourceCategory,
      source_fetcher_type: item.sourceFetcherType ?? null,
      category: item.category,
      top_circle: item.topCircle,
      alert_type: item.alertType,
      alert_level: item.alertLevel,
      quality_score: item.qualityScore,
      related_count: item.relatedCount
    }
  };
}

function entityType(type: string): string {
  const labels: Record<string, string> = {
    company: "公司",
    person: "人物",
    policy: "政策",
    product: "产品",
    project: "项目",
    location: "地点",
    technology: "技术"
  };
  return labels[type] ?? type;
}

export async function createMirofishProjectFromItem(
  item: ItemDetailDto,
  userRequirement?: string | null
): Promise<{
  projectId: string;
  projectUrl: string;
}> {
  const config = getMirofishConfig();
  const payload = buildMirofishSeedPayload(item, userRequirement);

  const response = await fetch(`${config.apiBaseUrl}/api/external/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  const responsePayload = (await response.json().catch(() => null)) as MirofishSeedResponse | null;

  if (!response.ok || !responsePayload?.success || !responsePayload.data?.project_id) {
    throw new MirofishRequestError(
      responsePayload?.error ?? responsePayload?.message ?? `MiroFish 创建项目失败: HTTP ${response.status}`
    );
  }

  return {
    projectId: responsePayload.data.project_id,
    projectUrl: `${config.webBaseUrl}/process/${encodeURIComponent(responsePayload.data.project_id)}`
  };
}
