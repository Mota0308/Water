import { ProductionCreateView } from "@/components/production/module-views";
import { loadCreateData } from "@/components/production/load-module-page";

export default async function ReplenishmentNewPage() {
  const data = await loadCreateData("replenishment");
  return (
    <ProductionCreateView
      module="replenishment"
      session={data.session}
      handlers={data.handlers}
    />
  );
}
