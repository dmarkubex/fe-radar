import { getDb, scoringConfig } from "@fe-radar/db";
import { ScoringConfigEditor } from "@/components/scoring-config/scoring-config-editor";
import type { ScoringConfigBody } from "@/lib/api/scoring-config-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockScoringConfig } from "@/lib/mock-data";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

const DEFAULT_WEIGHTS: ScoringConfigBody["weights"] = { w1: 0.25, w2: 0.2, w3: 0.2, w4: 0.2, w5: 0.15 };
const DEFAULT_T_COEF: ScoringConfigBody["tCoef"] = { T1: 1.2, T2: 1.0, T3: 0.8 };
const DEFAULT_C_COEF: ScoringConfigBody["cCoef"] = { C1: 1.2, C2: 1.0, C3: 0.8 };
// Keyed by item category (matches 0002 seed, worker runner defaults, and the
// curator lookup). Used only as a fallback when scoring_config has no row yet.
const DEFAULT_THRESHOLDS: ScoringConfigBody["thresholds"] = {
  "政策与标准": { C1: 55, C2: 60, C3: 65 },
  "市场与价格": { C1: 55, C2: 60, C3: 70 },
  "技术与产品": { C1: 55, C2: 65, C3: 75 },
  "项目与招投标": { C1: 50, C2: 60, C3: 70 },
  "公司与资本": { C1: 55, C2: 65, C3: 75 },
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
    <PageFrame size="full">
      <PageHeader
        eyebrow="/ 评分配置 · ADMIN · SCORING"
        title="评分配置"
        description="调整评分权重、信源与关注圈系数，以及各分类精选阈值。"
      />
      <div className="pb-24">
        <ScoringConfigEditor initialValue={initial} />
      </div>
    </PageFrame>
  );
}
