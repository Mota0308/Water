import { ProductionMyTasksView } from "@/components/production/module-views";
import { loadMyTasksData } from "@/components/production/load-module-page";

export default async function ProductionMyTasksPage() {
  const data = await loadMyTasksData("production");
  return (
    <ProductionMyTasksView
      module="production"
      session={data.session}
      tasks={data.tasks}
    />
  );
}
