import { ProductionHomeView } from "@/components/production/module-views";
import { loadHomeData } from "@/components/production/load-module-page";

export default async function ProductionHomePage() {
  const data = await loadHomeData("production");
  return (
    <ProductionHomeView
      module="production"
      session={data.session}
      summary={data.summary}
      tasks={data.tasks}
      waitingProjects={data.waitingProjects}
    />
  );
}
