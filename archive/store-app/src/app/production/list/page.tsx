import { ProductionListView } from "@/components/production/module-views";
import { loadListData } from "@/components/production/load-module-page";

export default async function ProductionListPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; keyword?: string }>;
}) {
  const params = await searchParams;
  const data = await loadListData("production", params);
  return (
    <ProductionListView
      module="production"
      session={data.session}
      projects={data.projects}
      filters={data.filters}
    />
  );
}
