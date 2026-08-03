import { ProductionCreateView } from "@/components/production/module-views";
import { loadCreateData } from "@/components/production/load-module-page";

export default async function ProductionNewPage() {
  const data = await loadCreateData("production");
  return (
    <ProductionCreateView
      module="production"
      session={data.session}
      handlers={data.handlers}
    />
  );
}
