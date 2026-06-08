import { EntityTable } from "@/components/entities/entity-table";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export default function AdminEntitiesPage(): React.JSX.Element {
  return (
    <PageFrame size="full">
      <PageHeader eyebrow="后台" title="实体词典" />
      <EntityTable />
    </PageFrame>
  );
}
