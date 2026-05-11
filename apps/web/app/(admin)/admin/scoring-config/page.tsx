import { getDb, scoringConfig } from "@fe-radar/db";
import { ScoringConfigEditor } from "@/components/scoring-config/scoring-config-editor";

export const dynamic = "force-dynamic";

export default async function AdminScoringConfigPage(): Promise<React.JSX.Element> {
  const rows = await getDb().select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium text-zinc-500">后台</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">评分配置</h1>
      </header>
      <ScoringConfigEditor
        initialValue={{
          weights: byKey.weights,
          tCoef: byKey.t_coef,
          cCoef: byKey.c_coef,
          thresholds: byKey.thresholds
        }}
      />
    </main>
  );
}
