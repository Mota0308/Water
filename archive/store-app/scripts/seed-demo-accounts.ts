import { MongoClient } from "mongodb";
import {
  createStoreWorkFlowApp,
  type AccountRole,
  type FixedUnit,
} from "../src/application/store-work-flow-app";

type SeedAccount = {
  loginName: string;
  password: string;
  displayName: string;
  role: AccountRole;
  fixedUnit?: FixedUnit;
  jobTitle?: string;
};

const ACCOUNTS: SeedAccount[] = [
  {
    loginName: "manager",
    password: "Manager123!",
    displayName: "一般管理層",
    role: "manager",
    jobTitle: "營運經理",
  },
  {
    loginName: "kt.staff",
    password: "Staff123!",
    displayName: "觀塘店員",
    role: "personal",
    fixedUnit: "觀塘",
    jobTitle: "店員",
  },
  {
    loginName: "lck.staff",
    password: "Staff123!",
    displayName: "荔枝角店員",
    role: "personal",
    fixedUnit: "荔枝角",
    jobTitle: "店員",
  },
  {
    loginName: "wc.staff",
    password: "Staff123!",
    displayName: "灣仔店員",
    role: "personal",
    fixedUnit: "灣仔",
    jobTitle: "店員",
  },
  {
    loginName: "tm.staff",
    password: "Staff123!",
    displayName: "屯門店員",
    role: "personal",
    fixedUnit: "屯門",
    jobTitle: "店員",
  },
  {
    loginName: "wh.staff",
    password: "Staff123!",
    displayName: "國內倉店員",
    role: "personal",
    fixedUnit: "國內倉",
    jobTitle: "倉務",
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("請先設定 MONGODB_URI");

  const adminLogin = process.env.SEED_ADMIN_LOGIN ?? "admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME ?? "store-work-flow");
  const app = createStoreWorkFlowApp({ db });

  await app.seedSystemAdmin({
    loginName: adminLogin,
    password: adminPassword,
    displayName: process.env.SEED_ADMIN_NAME ?? "系統管理員",
  });

  const login = await app.login({
    loginName: adminLogin,
    password: adminPassword,
  });
  if (!login.ok) {
    throw new Error("系統管理員登入失敗，請先確認 admin 密碼");
  }

  for (const account of ACCOUNTS) {
    const result = await app.createAccount(login.sessionId, account);
    if (result.ok) {
      console.log(
        `已建立 ${account.role}：${account.loginName} / ${account.password}（${account.displayName}）`,
      );
    } else if (result.error === "login_name_taken") {
      console.log(`已存在，略過：${account.loginName}`);
    } else {
      console.error(`建立失敗 ${account.loginName}:`, result.error);
    }
  }

  await app.logout(login.sessionId);
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
