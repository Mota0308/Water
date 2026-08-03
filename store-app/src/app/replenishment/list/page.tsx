import { ProductionListView } from "@/components/production/module-views";
import { loadListData } from "@/components/production/load-module-page";

export default async function ReplenishmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; keyword?: string }>;
}) {
  const params = await searchParams;
  const data = await loadListData("replenishment", params);
  return (
    <ProductionListView
      module="replenishment"
      session={data.session}
      projects={data.projects}
      filters={data.filters}
    />
  );
}
