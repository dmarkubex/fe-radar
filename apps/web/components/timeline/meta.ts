import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export const CATEGORY_TABS = [
  { value: "policy", label: "政策" },
  { value: "market", label: "市场" },
  { value: "tech", label: "技术" },
  { value: "project", label: "项目" },
  { value: "company", label: "公司" }
];

export const CIRCLE_FILTERS = [
  { value: "C1", label: "C1 自家公司" },
  { value: "C2", label: "C2 关键链条" },
  { value: "C3", label: "C3 行业面" }
];

export function formatAppTime(value: string | null): string {
  if (!value) {
    return "-";
  }
  return dayjs(value).tz(APP_TIMEZONE).format("MM-DD HH:mm");
}

export function scoreLabel(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

/** 五维评分 — 业务界面展示用中文标签 */
export const SCORE_DIMENSIONS = [
  { key: "d1Policy", label: "政策与标准", abbr: "D1" },
  { key: "d2Chain", label: "产业链关联", abbr: "D2" },
  { key: "d3Market", label: "市场与价格", abbr: "D3" },
  { key: "d4Tech", label: "技术与产品", abbr: "D4" },
  { key: "d5Business", label: "商业与风险", abbr: "D5" },
] as const;

export type ScoreDimensionKey = (typeof SCORE_DIMENSIONS)[number]["key"];

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  company: "企业",
  person: "人物",
  product: "产品",
  policy: "政策",
  technology: "技术",
  region: "地区",
  event: "事件",
  event_type: "事件类型",
  project_type: "项目类型",
  money: "金额",
  organization: "机构",
};

export function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type;
}
