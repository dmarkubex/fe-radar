import { SourceTable } from "./source-table";

export default function AdminSourcesPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-bg px-6 py-8 font-body text-fg">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-wide text-fg-soft uppercase">
            / 信源管理 · ADMIN · SOURCES
          </p>
          <h1 className="font-display text-3xl tracking-tightest text-fg">
            信源管理
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            管理 T1 / T2 / T3 信源，监控抓取健康度，新增或停用信源。
          </p>
        </header>
        <SourceTable />
      </div>
    </main>
  );
}
