"use client";

import { useState } from "react";

export interface TargetFormData {
  id?: number;
  name: string;
  webhookUrl: string;
  signSecret?: string | null;
  enabled: boolean;
}

interface TargetFormProps {
  initial?: TargetFormData;
  onSaved(): void;
  onCancel?(): void;
}

const FIELD =
  "h-9 w-full border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-soft focus:outline-none focus:border-accent";

export function TargetForm({ initial, onSaved, onCancel }: TargetFormProps): React.JSX.Element {
  const isEditing = !!initial?.id;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(formData: FormData): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const name = String(formData.get("name") ?? "").trim();
      const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
      const signSecretRaw = String(formData.get("signSecret") ?? "").trim();

      const body: Record<string, unknown> = {
        name,
        channel: "dingtalk_bot",
        webhookUrl,
        enabled: true
      };

      // Only include signSecret if non-empty (empty = keep existing on edit)
      if (signSecretRaw !== "") {
        body["signSecret"] = signSecretRaw;
      } else if (!isEditing) {
        body["signSecret"] = null;
      }

      const url = isEditing
        ? `/api/briefing/targets/${initial!.id}`
        : "/api/briefing/targets";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const data = await response.json() as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "保存失败");
      }

      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form action={submit} className="space-y-4">
      <h3 className="font-display text-base font-semibold text-fg">
        {isEditing ? "编辑推送目标" : "新增推送目标"}
      </h3>
      <p className="font-mono text-[11px] text-fg-soft">
        渠道固定为钉钉群机器人（dingtalk_bot）。
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            名称
          </label>
          <input
            className={FIELD}
            name="name"
            placeholder="推送目标名称"
            defaultValue={initial?.name ?? ""}
            required
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            渠道
          </label>
          <input
            className={`${FIELD} cursor-not-allowed opacity-60`}
            value="dingtalk_bot"
            readOnly
            aria-label="渠道（固定）"
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            Webhook URL
          </label>
          <input
            className={FIELD}
            name="webhookUrl"
            type="url"
            placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
            defaultValue={initial?.webhookUrl ?? ""}
            required
          />
        </div>

        <div>
          <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-fg-soft">
            加签密钥（Sign Secret）
          </label>
          <input
            className={FIELD}
            name="signSecret"
            type="password"
            placeholder={isEditing ? "留空则保持原值不变" : "可选，填写后开启加签"}
            autoComplete="new-password"
          />
          {isEditing ? (
            <p className="mt-1 font-mono text-[10px] text-fg-soft">
              当前已设置密钥（显示掩码）。留空提交则保持原值不改。
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 border border-accent bg-accent py-2 font-mono text-xs uppercase tracking-wide text-bg transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "保存中…" : isEditing ? "保存修改" : "新建"}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="border border-border bg-surface px-4 py-2 font-mono text-xs uppercase tracking-wide text-fg-muted transition-colors hover:bg-bg-deep"
          >
            取消
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="font-mono text-xs text-danger" role="alert">{error}</p>
      ) : null}
    </form>
  );
}
