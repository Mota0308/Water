import { ProductionDetailView } from "@/components/production/module-views";
import { loadDetailData } from "@/components/production/load-module-page";

export default async function ProductionProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadDetailData("production", id);
  return (
    <ProductionDetailView
      module="production"
      session={data.session}
      project={data.project}
      handlers={data.handlers}
      comments={data.comments}
      files={data.files}
    />
  );
}
