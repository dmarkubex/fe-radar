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

export function alertBarClass(alertType: string | null, circle: string | null): string {
  if (alertType === "own") {
    return circle === "C1" ? "bg-red-600" : circle === "C2" ? "bg-orange-500" : "bg-yellow-500";
  }
  if (alertType === "safety") {
    return "bg-zinc-500";
  }
  if (alertType === "policy") {
    return "bg-blue-600";
  }
  return circle === "C1" ? "bg-red-300" : circle === "C2" ? "bg-orange-300" : "bg-zinc-300";
}

export function scoreLabel(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}
