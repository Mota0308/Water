import { ProductionMyTasksView } from "@/components/production/module-views";
import { loadMyTasksData } from "@/components/production/load-module-page";

export default async function ReplenishmentMyTasksPage() {
  const data = await loadMyTasksData("replenishment");
  return (
    <ProductionMyTasksView
      module="replenishment"
      session={data.session}
      tasks={data.tasks}
    />
  );
}
