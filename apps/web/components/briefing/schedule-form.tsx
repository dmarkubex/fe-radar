"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface ScheduleConfig {
  enabled: boolean;
  sendTime: string;
  briefingSendTime: string;
  scheduleMode: "daily" | "business_days";
  baseUrl: string;
}

interface ScheduleFormProps {
  /** When true, show explicit empty-target warning (no targets will not send). */
  targetCount?: number;
}

const FIELD =
  "h-9 w-full border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-soft focus:outline-none focus:border-accent";

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: false,
  sendTime: "16:15",
  briefingSendTime: "17:00",
  scheduleMode: "business_days",
  baseUrl: "http://fe-radar.internal",
};

export function ScheduleForm({ targetCount }: ScheduleFormProps): React.JSX.Element {
  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/briefing/schedule", { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? "调度配置加载失败");
      }
      const payload = (await response.json()) as { config: ScheduleConfig };
      setConfig({
        enabled: payload.config.enabled,
        sendTime: payload.config.sendTime,
        briefingSendTime: payload.config.briefingSendTime,
        scheduleMode: payload.config.scheduleMode,
        baseUrl: payload.config.baseUrl,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    setSavedMsg(null);
    setSaving(true);
    try {
      const body = {
        enabled: formData.get("enabled") === "on",
        sendTime: String(formData.get("sendTime") ?? "").trim(),
        briefingSendTime: String(formData.get("briefingSendTime") ?? "").trim(),
        scheduleMode: String(formData.get("scheduleMode") ?? "business_days") as
          | "daily"
          | "business_days",
        baseUrl: String(formData.get("baseUrl") ?? "").trim(),
      };

      const response = await fetch("/api/briefing/schedule", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: { message?: string; details?: unknown };
        };
        throw new Error(data.error?.message ?? "保存失败");
      }

      const payload = (await response.json()) as { config: ScheduleConfig };
      setConfig({
        enabled: payload.config.enabled,
        sendTime: payload.config.sendTime,
        briefingSendTime: payload.config.briefingSendTime,
        scheduleMode: payload.config.scheduleMode,
        baseUrl: payload.config.baseUrl,
      });
      setSavedMsg("已保存。下一分钟起按新配置调度，无需重启 worker。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const noTargets = typeof targetCount === "number" && targetCount === 0;

  return (
    <section className="panel-surface" data-testid="daily-push-schedule-form">
      <div className="border-b border-hairline px-6 py-4">
        <h3 className="font-display text-base font-semibold text-fg">日报定时发送（两张独立卡片）</h3>
        <p className="mt-1 font-mono text-[11px] text-fg-soft">
          时区固定 Asia/Shanghai · 产业日报与铜锂日报各一张 ActionCard、各自独立发送时间 · 配置存数据库
        </p>
      </div>

      <div className="space-y-4 px-6 py-5">
        {loading ? (
          <p className="font-mono text-sm text-fg-muted">加载中…</p>
        ) : (
          <form action={submit} className="space-y-4">
            <label className="flex items-center gap-3 text-sm text-fg">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={config.enabled}
                className="h-4 w-4 accent-accent"
                data-testid="schedule-enabled"
              />
              <span>启用定时发送（默认关闭，部署本身不会自动发消息）</span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="eyebrow">产业日报发送时间 HH:mm</span>
                <input
                  className={FIELD}
                  name="sendTime"
                  defaultValue={config.sendTime}
                  placeholder="09:00"
                  pattern="(?:[01]\d|2[0-3]):[0-5]\d"
                  required
                  data-testid="schedule-send-time"
                />
                <span className="block font-mono text-[11px] text-fg-soft">
                  日报 08:00 生成，请留出余量。
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="eyebrow">铜锂日报发送时间 HH:mm</span>
                <input
                  className={FIELD}
                  name="briefingSendTime"
                  defaultValue={config.briefingSendTime}
                  placeholder="17:00"
                  pattern="(?:[01]\d|2[0-3]):[0-5]\d"
                  required
                  data-testid="schedule-briefing-send-time"
                />
                <span className="block font-mono text-[11px] text-fg-soft">
                  铜锂简报工作日 16:00 生成，请留出余量。
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="eyebrow">发送日模式</span>
                <select
                  className={FIELD}
                  name="scheduleMode"
                  defaultValue={config.scheduleMode}
                  data-testid="schedule-mode"
                >
                  <option value="business_days">工作日（跳过周末与节假日）</option>
                  <option value="daily">每日</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="eyebrow">站内访问基址 baseUrl</span>
              <input
                className={FIELD}
                name="baseUrl"
                defaultValue={config.baseUrl}
                placeholder="http://fe-radar.internal"
                required
                data-testid="schedule-base-url"
              />
              <span className="block font-mono text-[11px] text-fg-soft">
                仅 http/https 绝对地址；末尾 / 保存时自动去除。按钮路径由代码固定拼接，不可自定义。
              </span>
            </label>

            {noTargets ? (
              <p
                className="border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-xs text-warn"
                role="status"
                data-testid="schedule-no-targets-warning"
              >
                当前无启用推送目标。即使调度已启用，也不会发送任何消息——请先在下方新增目标。
              </p>
            ) : null}

            {error ? (
              <p className="font-mono text-sm text-danger" role="alert" data-testid="schedule-error">
                {error}
              </p>
            ) : null}
            {savedMsg ? (
              <p className="font-mono text-sm text-ok" role="status" data-testid="schedule-saved">
                {savedMsg}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving} data-testid="schedule-save">
                {saving ? "保存中…" : "保存调度配置"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
