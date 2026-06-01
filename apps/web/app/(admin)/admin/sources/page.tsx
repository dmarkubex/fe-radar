import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

import { SourceTable } from "./source-table";

export default function AdminSourcesPage(): React.JSX.Element {
  return (
    <PageFrame size="full">
      <PageHeader
        eyebrow="/ 信源管理 · ADMIN · SOURCES"
        title="信源管理"
        description="管理 T1 / T2 / T3 信源，监控抓取健康度，新增或停用信源。"
      />
      <SourceTable />
    </PageFrame>
  );
}
