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
    loginName: "tm.a",
    password: "Staff123!",
    displayName: "屯門甲",
    role: "personal",
    fixedUnit: "屯門",
  });

  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager login failed");

  return { app, managerSessionId: managerLogin.sessionId };
}

describe("門市工作流程應用服務 — 跨單位進度", () => {
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

  it("個人可看五單位當日摘要與其他單位唯讀清單", async () => {
    const { app, managerSessionId } = await boot(db);
    await app.createAdhocWork(managerSessionId, {
      title: "屯門清潔",
      content: "不應出現在跨單位詳情的機密說明",
      units: ["屯門"],
      priority: "normal",
    });

    const tmLogin = await app.login({
      loginName: "tm.a",
      password: "Staff123!",
    });
    if (!tmLogin.ok) throw new Error("tm login failed");
    const tmToday = await app.getTodayWork(tmLogin.sessionId);
    if (!tmToday.ok) throw new Error("tm today failed");
    await app.completeWork(tmLogin.sessionId, {
      workId: tmToday.works[0]!.id,
    });

    const ktLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!ktLogin.ok) throw new Error("kt login failed");

    const progress = await app.listUnitProgress(ktLogin.sessionId);
    expect(progress).toMatchObject({
      ok: true,
      readOnlyNotice: "你正在查看其他單位的工作進度，此頁面只供查看，不可修改。",
      units: expect.arrayContaining([
        expect.objectContaining({
          unit: "屯門",
          total: 1,
          completed: 1,
          percent: 100,
        }),
        expect.objectContaining({ unit: "觀塘", total: 0 }),
        expect.objectContaining({ unit: "國內倉" }),
      ]),
    });
    if (progress.ok) {
      expect(progress.units).toHaveLength(5);
    }

    const tmView = await app.getUnitWorkReadonly(ktLogin.sessionId, {
      unit: "屯門",
    });
    expect(tmView).toMatchObject({
      ok: true,
      readOnlyNotice: "你正在查看其他單位的工作進度，此頁面只供查看，不可修改。",
      works: [
        expect.objectContaining({
          title: "屯門清潔",
          status: "completed",
          completedByDisplayName: "屯門甲",
        }),
      ],
    });
    if (tmView.ok) {
      expect(tmView.works[0]).not.toHaveProperty("content");
      expect(JSON.stringify(tmView.works[0])).not.toContain("機密說明");
    }
  });

  it("取消剔選後跨單位最後更新時間會刷新", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "觀塘工作",
      content: "內容",
      units: ["觀塘"],
      priority: "normal",
    });
    if (!created.ok) throw new Error("create failed");

    const tmLogin = await app.login({
      loginName: "tm.a",
      password: "Staff123!",
    });
    if (!tmLogin.ok) throw new Error("tm login failed");

    const before = await app.getUnitWorkReadonly(tmLogin.sessionId, {
      unit: "觀塘",
    });
    if (!before.ok) throw new Error("before failed");
    const beforeUpdated = before.works[0]!.lastUpdatedAt.getTime();

    const ktLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!ktLogin.ok) throw new Error("kt login failed");

    await app.completeWork(ktLogin.sessionId, {
      workId: created.works[0]!.id,
    });
    await app.cancelOwnCompletion(ktLogin.sessionId, {
      workId: created.works[0]!.id,
    });

    const after = await app.getUnitWorkReadonly(tmLogin.sessionId, {
      unit: "觀塘",
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.works[0]!.lastUpdatedAt.getTime()).toBeGreaterThan(
      beforeUpdated,
    );
  });

  it("跨單位 API 不可完成或取消其他單位工作", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "屯門工作",
      content: "內容",
      units: ["屯門"],
      priority: "normal",
    });
    if (!created.ok) throw new Error("create failed");

    const ktLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!ktLogin.ok) throw new Error("kt login failed");

    expect(
      await app.completeWork(ktLogin.sessionId, {
        workId: created.works[0]!.id,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});
