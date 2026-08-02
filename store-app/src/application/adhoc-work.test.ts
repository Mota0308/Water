import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

const ADMIN = {
  loginName: "admin",
  password: "Secret123!",
  displayName: "系統管理員",
};

async function boot(db: Db) {
  const app = createStoreWorkFlowApp({ db });
  await app.seedSystemAdmin(ADMIN);
  const adminLogin = await app.login(ADMIN);
  if (!adminLogin.ok) throw new Error("admin login failed");

  const manager = await app.createAccount(adminLogin.sessionId, {
    loginName: "manager.one",
    password: "Manager123!",
    displayName: "一般管理",
    role: "manager",
  });
  if (!manager.ok) throw new Error("manager create failed");

  const staffA = await app.createAccount(adminLogin.sessionId, {
    loginName: "kt.a",
    password: "Staff123!",
    displayName: "觀塘甲",
    role: "personal",
    fixedUnit: "觀塘",
  });
  const staffB = await app.createAccount(adminLogin.sessionId, {
    loginName: "kt.b",
    password: "Staff123!",
    displayName: "觀塘乙",
    role: "personal",
    fixedUnit: "觀塘",
  });
  const tmStaff = await app.createAccount(adminLogin.sessionId, {
    loginName: "tm.a",
    password: "Staff123!",
    displayName: "屯門甲",
    role: "personal",
    fixedUnit: "屯門",
  });
  if (!staffA.ok || !staffB.ok || !tmStaff.ok) throw new Error("staff create failed");

  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager login failed");

  return {
    app,
    adminSessionId: adminLogin.sessionId,
    managerSessionId: managerLogin.sessionId,
    staffA,
    staffB,
    tmStaff,
  };
}

async function loginAs(
  app: ReturnType<typeof createStoreWorkFlowApp>,
  loginName: string,
) {
  const login = await app.login({ loginName, password: "Staff123!" });
  if (!login.ok) throw new Error(`login failed for ${loginName}`);
  return login.sessionId;
}

describe("門市工作流程應用服務 — 突發工作", () => {
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

  it("一般管理層可為多單位建立突發工作", async () => {
    const { app, managerSessionId } = await boot(db);

    const created = await app.createAdhocWork(managerSessionId, {
      title: "更換宣傳物品",
      content: "更換櫥窗海報",
      units: ["觀塘", "屯門"],
      priority: "important",
      dueAt: new Date("2026-08-02T18:00:00+08:00"),
    });

    expect(created).toMatchObject({
      ok: true,
      works: expect.arrayContaining([
        expect.objectContaining({
          title: "更換宣傳物品",
          unit: "觀塘",
          priority: "important",
          status: "pending",
          type: "adhoc",
        }),
        expect.objectContaining({
          unit: "屯門",
          status: "pending",
        }),
      ]),
    });
    if (created.ok) {
      expect(created.works).toHaveLength(2);
    }
  });

  it("個人今日工作顯示所屬單位進度；可剔選完成並記錄完成者", async () => {
    const { app, managerSessionId } = await boot(db);
    await app.createAdhocWork(managerSessionId, {
      title: "開舖檢查",
      content: "檢查設備",
      units: ["觀塘"],
      priority: "normal",
    });

    const sessionId = await loginAs(app, "kt.a");
    const today = await app.getTodayWork(sessionId);
    expect(today).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        completed: 0,
        pending: 1,
        overdue: 0,
        percent: 0,
      },
    });
    if (!today.ok) return;

    const workId = today.works[0]?.id;
    expect(workId).toBeTruthy();

    const completed = await app.completeWork(sessionId, { workId: workId! });
    expect(completed).toEqual({ ok: true });

    const after = await app.getTodayWork(sessionId);
    expect(after).toMatchObject({
      ok: true,
      summary: { total: 1, completed: 1, pending: 0, percent: 100 },
      works: [
        expect.objectContaining({
          status: "completed",
          completedByDisplayName: "觀塘甲",
        }),
      ],
    });
  });

  it("完成後他人不可再剔選；完成者可取消自己的剔選，他人不可取消", async () => {
    const { app, managerSessionId } = await boot(db);
    await app.createAdhocWork(managerSessionId, {
      title: "清潔指定位置",
      content: "清潔",
      units: ["觀塘"],
      priority: "normal",
    });

    const a = await loginAs(app, "kt.a");
    const b = await loginAs(app, "kt.b");
    const today = await app.getTodayWork(a);
    if (!today.ok) throw new Error("today failed");
    const workId = today.works[0]!.id;

    expect(await app.completeWork(a, { workId })).toEqual({ ok: true });
    expect(await app.completeWork(b, { workId })).toEqual({
      ok: false,
      error: "already_completed",
    });

    expect(await app.cancelOwnCompletion(b, { workId })).toEqual({
      ok: false,
      error: "not_completer",
    });
    expect(await app.cancelOwnCompletion(a, { workId })).toEqual({ ok: true });

    const again = await app.completeWork(b, { workId });
    expect(again).toEqual({ ok: true });
  });

  it("個人無法操作其他單位工作", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "屯門臨時點算",
      content: "點算",
      units: ["屯門"],
      priority: "urgent",
    });
    if (!created.ok) throw new Error("create failed");
    const tmWorkId = created.works[0]!.id;

    const ktSession = await loginAs(app, "kt.a");
    expect(await app.completeWork(ktSession, { workId: tmWorkId })).toEqual({
      ok: false,
      error: "forbidden",
    });

    const ktToday = await app.getTodayWork(ktSession);
    expect(ktToday).toMatchObject({
      ok: true,
      summary: { total: 0 },
      works: [],
    });
  });

  it("完成與取消留下稽核記錄", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "緊急設備檢查",
      content: "檢查冷氣",
      units: ["觀塘"],
      priority: "urgent",
    });
    if (!created.ok) throw new Error("create failed");
    const workId = created.works[0]!.id;

    const a = await loginAs(app, "kt.a");
    await app.completeWork(a, { workId });
    await app.cancelOwnCompletion(a, { workId });

    const audit = await app.listWorkAudit(managerSessionId, { workId });
    expect(audit).toMatchObject({
      ok: true,
      entries: expect.arrayContaining([
        expect.objectContaining({
          action: "complete",
          actorDisplayName: "觀塘甲",
          fromStatus: "pending",
          toStatus: "completed",
        }),
        expect.objectContaining({
          action: "cancel_completion",
          actorDisplayName: "觀塘甲",
          fromStatus: "completed",
          toStatus: "pending",
        }),
      ]),
    });
  });
});
