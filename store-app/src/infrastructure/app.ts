import { createStoreWorkFlowApp } from "@/application/store-work-flow-app";
import { getDb } from "@/infrastructure/mongo";

export async function getStoreWorkFlowApp() {
  const db = await getDb();
  return createStoreWorkFlowApp({ db });
}
