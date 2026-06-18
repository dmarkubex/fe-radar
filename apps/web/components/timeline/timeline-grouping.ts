import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import type { TimelineItemDto } from "@/lib/api/timeline-query";

export type TimePeriod = "dawn" | "morning" | "afternoon" | "evening";

export interface PeriodGroup {
  period: TimePeriod;
  label: string; // 凌晨 / 上午 / 下午 / 晚间
  items: TimelineItemDto[];
}

export interface DayGroup {
  dayKey: string; // 'YYYY-MM-DD' in Asia/Shanghai
  dayLabel: string; // 今天 / 昨天 / M月D日 星期X
  periods: PeriodGroup[]; // 非空段，段倒序（evening first）
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  dawn: "凌晨",
  morning: "上午",
  afternoon: "下午",
  evening: "晚间"
};

const WEEK_CHARS = ["日", "一", "二", "三", "四", "五", "六"];

// [0,6)=凌晨 [6,12)=上午 [12,18)=下午 [18,24)=晚间
export function getTimePeriod(d: Date | string): TimePeriod {
  const hour = dayjs(d).tz(APP_TIMEZONE).hour();
  if (hour < 6) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// now 参数用于测试注入，生产时使用 dayjs().tz(APP_TIMEZONE)
export function getRelativeDayLabel(d: Date | string, now?: Date | string): string {
  const itemDay = dayjs(d).tz(APP_TIMEZONE).startOf("day");
  const today = now
    ? dayjs(now).tz(APP_TIMEZONE).startOf("day")
    : dayjs().tz(APP_TIMEZONE).startOf("day");
  const diff = today.diff(itemDay, "day");
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  // M月D日 星期X
  const d2 = dayjs(d).tz(APP_TIMEZONE);
  return `${d2.month() + 1}月${d2.date()}日 星期${WEEK_CHARS[d2.day()]}`;
}

// 在已 flatMap 的全量 items 上分组；日倒序、段倒序；空段不渲染
export function groupTimeline(items: TimelineItemDto[]): DayGroup[] {
  const PERIOD_ORDER: TimePeriod[] = ["dawn", "morning", "afternoon", "evening"];

  // 按 dayKey 聚合，使用 Map 保持插入顺序
  const dayMap = new Map<
    string,
    {
      dayLabel: string;
      periodMap: Map<TimePeriod, TimelineItemDto[]>;
    }
  >();

  for (const item of items) {
    const d = dayjs(item.publishedAt).tz(APP_TIMEZONE);
    const dayKey = d.format("YYYY-MM-DD");
    const period = getTimePeriod(item.publishedAt);

    if (!dayMap.has(dayKey)) {
      dayMap.set(dayKey, {
        dayLabel: getRelativeDayLabel(item.publishedAt),
        periodMap: new Map()
      });
    }
    const dayEntry = dayMap.get(dayKey)!;
    if (!dayEntry.periodMap.has(period)) {
      dayEntry.periodMap.set(period, []);
    }
    dayEntry.periodMap.get(period)!.push(item);
  }

  // 日倒序（key 是 YYYY-MM-DD，字典序倒序等于日期倒序）
  const sortedDayKeys = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));

  return sortedDayKeys.map((dayKey) => {
    const { dayLabel, periodMap } = dayMap.get(dayKey)!;
    // 段倒序：evening → afternoon → morning → dawn
    const periods: PeriodGroup[] = [...PERIOD_ORDER]
      .reverse()
      .filter((p) => periodMap.has(p))
      .map((p) => ({
        period: p,
        label: PERIOD_LABELS[p],
        items: periodMap.get(p)!
      }));
    return { dayKey, dayLabel, periods };
  });
}
