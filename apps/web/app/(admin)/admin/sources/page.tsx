import { SourceTable } from "./source-table";

export default function AdminSourcesPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium text-zinc-500">后台</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">信源管理</h1>
      </header>
      <SourceTable />
    </main>
  );
}
