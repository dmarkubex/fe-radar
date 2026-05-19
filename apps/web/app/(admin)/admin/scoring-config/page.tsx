import { getDb, scoringConfig } from "@fe-radar/db";
import { ScoringConfigEditor } from "@/components/scoring-config/scoring-config-editor";
import type { ScoringConfigBody } from "@/lib/api/scoring-config-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockScoringConfig } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

const DEFAULT_WEIGHTS: ScoringConfigBody["weights"] = { w1: 0.25, w2: 0.2, w3: 0.2, w4: 0.2, w5: 0.15 };
const DEFAULT_T_COEF: ScoringConfigBody["tCoef"] = { T1: 1.2, T2: 1.0, T3: 0.8 };
const DEFAULT_C_COEF: ScoringConfigBody["cCoef"] = { C1: 1.2, C2: 1.0, C3: 0.8 };
const DEFAULT_THRESHOLDS: ScoringConfigBody["thresholds"] = {
  own: { C1: 60, C2: 70, C3: 80 },
  safety: { C1: 55, C2: 65, C3: 75 },
  policy: { C1: 50, C2: 60, C3: 70 },
  market: { C1: 50, C2: 60, C3: 70 },
  tech: { C1: 50, C2: 60, C3: 70 },
};

export default async function AdminScoringConfigPage(): Promise<React.JSX.Element> {
  if (isMockMode()) {
    return <ScoringConfigPageContent initial={mockScoringConfig} />;
  }
  const rows = await getDb().select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  const initial: ScoringConfigBody = {
    weights: (byKey.weights as ScoringConfigBody["weights"] | undefined) ?? DEFAULT_WEIGHTS,
    tCoef: (byKey.t_coef as ScoringConfigBody["tCoef"] | undefined) ?? DEFAULT_T_COEF,
    cCoef: (byKey.c_coef as ScoringConfigBody["cCoef"] | undefined) ?? DEFAULT_C_COEF,
    thresholds: (byKey.thresholds as ScoringConfigBody["thresholds"] | undefined) ?? DEFAULT_THRESHOLDS,
  };

  return <ScoringConfigPageContent initial={initial} />;
}

function ScoringConfigPageContent({ initial }: { initial: ScoringConfigBody }): React.JSX.Element {
  return (
    <main className="min-h-screen bg-bg px-6 py-8 font-body text-fg">
      <div className="mx-auto w-full max-w-7xl space-y-8 pb-24">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-wide text-fg-soft uppercase">
            / 评分配置 · ADMIN · SCORING
          </p>
          <h1 className="font-display text-3xl tracking-tightest text-fg">
            评分配置
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            调一次权重，等半秒回测就知道效果。
          </p>
        </header>

        <ScoringConfigEditor initialValue={initial} />
      </div>
    </main>
  );
}
