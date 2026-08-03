import { MongoClient } from "mongodb";
import { createStoreWorkFlowApp } from "../src/application/store-work-flow-app";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("請先設定 MONGODB_URI");
  }

  const loginName = process.env.SEED_ADMIN_LOGIN ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const displayName = process.env.SEED_ADMIN_NAME ?? "系統管理員";

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME ?? "store-work-flow");
  const app = createStoreWorkFlowApp({ db });

  await app.seedSystemAdmin({ loginName, password, displayName });
  console.log(`已確保系統管理員存在：${loginName}`);

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
