import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db) {
  const app = createStoreWorkFlowApp({ db });
  await app.seedSystemAdmin({
    loginName: "admin",
    password: "Secret123!",
    displayName: "系統管理員",
  });
  const adminLogin = await app.login({
    loginName: "admin",
    password: "Secret123!",
  });
  if (!adminLogin.ok) throw new Error("admin login failed");
  await app.createAccount(adminLogin.sessionId, {
    loginName: "manager.one",
    password: "Manager123!",
    displayName: "一般管理",
    role: "manager",
  });
  await app.createAccount(adminLogin.sessionId, {
    loginName: "kt.a",
    password: "Staff123!",
    displayName: "觀塘甲",
    role: "personal",
    fixedUnit: "觀塘",
  });
  await app.createAccount(adminLogin.sessionId, {
    loginName: "wh.a",
    password: "Staff123!",
    displayName: "倉務甲",
    role: "personal",
    fixedUnit: "國內倉",
  });
  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager login failed");
  return { app, managerSessionId: managerLogin.sessionId };
}

describe("門市工作流程應用服務 — 每日結算預留", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("store-work-flow-test");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("每日結算只產生四間門市實例，不含國內倉", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createDailySettlementWork(managerSessionId, {
      title: "每日結算工作",
      content: "連接第二部分",
      priority: "important",
    });

    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    expect(created.works).toHaveLength(4);
    expect(created.works.every((work) => work.unit !== "國內倉")).toBe(true);
    expect(created.works.every((work) => work.type === "daily_settlement")).toBe(
      true,
    );
    expect(
      created.works.every((work) => work.settlementState === "awaiting_part2"),
    ).toBe(true);
  });

  it("門市可見但不可手動完成或取消；國內倉進度不含日結", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createDailySettlementWork(managerSessionId, {
      title: "每日結算工作",
      content: "連接第二部分",
      priority: "important",
    });
    if (!created.ok) throw new Error("create failed");
    const ktWork = created.works.find((work) => work.unit === "觀塘");
    expect(ktWork).toBeTruthy();

    const ktLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!ktLogin.ok) throw new Error("kt login failed");

    const today = await app.getTodayWork(ktLogin.sessionId);
    expect(today).toMatchObject({
      ok: true,
      works: [
        expect.objectContaining({
          type: "daily_settlement",
          settlementState: "awaiting_part2",
        }),
      ],
    });

    expect(
      await app.completeWork(ktLogin.sessionId, { workId: ktWork!.id }),
    ).toEqual({ ok: false, error: "reserved_for_part2" });
    expect(
      await app.cancelOwnCompletion(ktLogin.sessionId, { workId: ktWork!.id }),
    ).toEqual({ ok: false, error: "reserved_for_part2" });

    const whLogin = await app.login({
      loginName: "wh.a",
      password: "Staff123!",
    });
    if (!whLogin.ok) throw new Error("wh login failed");
    const whToday = await app.getTodayWork(whLogin.sessionId);
    expect(whToday).toMatchObject({
      ok: true,
      summary: { total: 0, pending: 0, completed: 0 },
      works: [],
    });

    const progress = await app.listUnitProgress(ktLogin.sessionId);
    if (!progress.ok) throw new Error("progress failed");
    const warehouse = progress.units.find((unit) => unit.unit === "國內倉");
    expect(warehouse).toMatchObject({ total: 0, pending: 0 });
  });
});
