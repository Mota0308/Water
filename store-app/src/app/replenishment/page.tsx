import { ProductionHomeView } from "@/components/production/module-views";
import { loadHomeData } from "@/components/production/load-module-page";

export default async function ReplenishmentHomePage() {
  const data = await loadHomeData("replenishment");
  return (
    <ProductionHomeView
      module="replenishment"
      session={data.session}
      summary={data.summary}
      tasks={data.tasks}
      waitingProjects={data.waitingProjects}
      mentions={data.mentions}
    />
  );
}
