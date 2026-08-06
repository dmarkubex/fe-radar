"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface TargetFormData {
  id?: number;
  name: string;
  /** Masked display only — never a raw webhook with access_token. */
  webhookUrlMasked?: string;
  webhookConfigured?: boolean;
  signSecretConfigured?: boolean;
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
        enabled: true
      };

      if (isEditing) {
        // Leave webhook empty → keep existing (do not send webhookUrl).
        if (webhookUrl !== "") {
          body["webhookUrl"] = webhookUrl;
        }
        // Leave secret empty → keep existing.
        if (signSecretRaw !== "") {
          body["signSecret"] = signSecretRaw;
        }
      } else {
        // Create requires webhook.
        body["webhookUrl"] = webhookUrl;
        body["signSecret"] = signSecretRaw !== "" ? signSecretRaw : null;
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
        渠道固定为钉钉群机器人（dingtalk_bot）。Webhook 与加签密钥仅存服务端，列表只显示掩码。
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block eyebrow">
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
          <label className="mb-1 block eyebrow">
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
          <label className="mb-1 block eyebrow">
            Webhook URL
          </label>
          <input
            className={FIELD}
            name="webhookUrl"
            type="url"
            // Never prefill raw webhook (API no longer returns it).
            defaultValue=""
            placeholder={
              isEditing
                ? "留空则保持原 Webhook 不变"
                : "https://oapi.dingtalk.com/robot/send?access_token=..."
            }
            required={!isEditing}
            data-testid="target-webhook-input"
          />
          {isEditing ? (
            <p className="mt-1 font-mono text-[10px] text-fg-soft" data-testid="target-webhook-hint">
              当前：{initial?.webhookUrlMasked ?? "—"}
              {initial?.webhookConfigured ? "（已配置）" : "（未配置）"}。留空提交则保持原值。
            </p>
          ) : null}
        </div>

        <div>
          <label className="mb-1 block eyebrow">
            加签密钥（Sign Secret）
          </label>
          <input
            className={FIELD}
            name="signSecret"
            type="password"
            placeholder={isEditing ? "留空则保持原值不变" : "可选，填写后开启加签"}
            autoComplete="new-password"
            data-testid="target-sign-secret-input"
          />
          {isEditing ? (
            <p className="mt-1 font-mono text-[10px] text-fg-soft">
              {initial?.signSecretConfigured
                ? "当前已配置密钥（不显示明文）。留空提交则保持原值。"
                : "当前未配置密钥。留空则仍不设置。"}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={saving}
          className="flex-1"
          variant="accent"
        >
          {saving ? "保存中…" : isEditing ? "保存修改" : "新建"}
        </Button>
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
