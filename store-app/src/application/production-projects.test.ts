import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { DEV_STAGES, REP_STAGES } from "./production-domain";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db) {
  const app = createStoreWorkFlowApp({ db });
  await app.seedSystemAdmin({
    loginName: "admin",
    password: "Admin123!",
    displayName: "系統管理員",
  });
  const admin = await app.login({
    loginName: "admin",
    password: "Admin123!",
  });
  if (!admin.ok) throw new Error("admin");

  await app.createAccount(admin.sessionId, {
    loginName: "manager",
    password: "Manager123!",
    displayName: "管理層",
    role: "manager",
  });
  await app.createAccount(admin.sessionId, {
    loginName: "ann",
    password: "Staff123!",
    displayName: "Ann",
    role: "personal",
    fixedUnit: "觀塘",
    department: "生產部",
  });
  await app.createAccount(admin.sessionId, {
    loginName: "coey",
    password: "Staff123!",
    displayName: "Coey",
    role: "personal",
    fixedUnit: "荔枝角",
    department: "銷售／生產",
  });

  const manager = await app.login({
    loginName: "manager",
    password: "Manager123!",
  });
  const ann = await app.login({ loginName: "ann", password: "Staff123!" });
  const coey = await app.login({ loginName: "coey", password: "Staff123!" });
  if (!manager.ok || !ann.ok || !coey.ok) throw new Error("logins");

  const handlers = await app.listPersonalHandlers(admin.sessionId);
  if (!handlers.ok) throw new Error("handlers");
  const annId = handlers.handlers.find((h) => h.displayName === "Ann")!.accountId;
  const coeyId = handlers.handlers.find((h) => h.displayName === "Coey")!.accountId;

  return {
    app,
    adminSessionId: admin.sessionId,
    managerSessionId: manager.sessionId,
    annSessionId: ann.sessionId,
    coeySessionId: coey.sessionId,
    annId,
    coeyId,
  };
}

describe("production projects API", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("prod-test");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("system_admin 可建立開發／補貨項目；manager／personal 不可", async () => {
    const ctx = await boot(db);
    const handlers = Array.from({ length: DEV_STAGES.length }, (_, i) =>
      i % 2 === 0 ? ctx.annId : ctx.coeyId,
    );

    const created = await ctx.app.createProductionProject(ctx.adminSessionId, {
      type: "dev",
      code: "WS-100",
      name: "成人光皮",
      category: "成人保暖衣",
      description: "示範",
      ownerAccountId: ctx.coeyId,
      dueDate: "2026-10-15",
      stageHandlerIds: handlers,
    });
    expect(created).toMatchObject({
      ok: true,
      project: {
        code: "WS-100",
        type: "dev",
        stages: expect.arrayContaining([
          expect.objectContaining({ name: "企劃選材", status: "待處理" }),
          expect.objectContaining({ name: "技術規格單", status: "未開始" }),
        ]),
      },
    });
    if (created.ok) {
      expect(created.project.stages).toHaveLength(DEV_STAGES.length);
    }

    const repHandlers = Array.from(
      { length: REP_STAGES.length },
      () => ctx.annId,
    );
    const rep = await ctx.app.createProductionProject(ctx.adminSessionId, {
      type: "rep",
      code: "WS-200",
      name: "補貨抓毛",
      category: "成人抓毛",
      stageHandlerIds: repHandlers,
    });
    expect(rep.ok).toBe(true);
    if (rep.ok) expect(rep.project.stages).toHaveLength(REP_STAGES.length);

    expect(
      await ctx.app.createProductionProject(ctx.managerSessionId, {
        type: "dev",
        code: "X",
        name: "Y",
        category: "其他",
        stageHandlerIds: handlers,
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      await ctx.app.createProductionProject(ctx.annSessionId, {
        type: "dev",
        code: "X",
        name: "Y",
        category: "其他",
        stageHandlerIds: handlers,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("可列表篩選；經手人可推進當前階段；manager 不可推進；admin 可確認待確認", async () => {
    const ctx = await boot(db);
    const handlers = Array.from({ length: DEV_STAGES.length }, () => ctx.annId);
    const created = await ctx.app.createProductionProject(ctx.adminSessionId, {
      type: "dev",
      code: "WS-300",
      name: "測試項目",
      category: "其他",
      stageHandlerIds: handlers,
    });
    if (!created.ok) throw new Error("create");

    const listed = await ctx.app.listProductionProjects(ctx.managerSessionId, {
      type: "dev",
      keyword: "WS-300",
    });
    expect(listed).toMatchObject({
      ok: true,
      projects: [expect.objectContaining({ code: "WS-300" })],
    });

    expect(
      await ctx.app.updateProductionStage(ctx.managerSessionId, {
        projectId: created.project.id,
        stageIndex: 0,
        status: "進行中",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      await ctx.app.updateProductionStage(ctx.annSessionId, {
        projectId: created.project.id,
        stageIndex: 0,
        status: "進行中",
      }),
    ).toMatchObject({ ok: true });

    expect(
      await ctx.app.updateProductionStage(ctx.annSessionId, {
        projectId: created.project.id,
        stageIndex: 0,
        status: "待確認",
        content: "請確認",
      }),
    ).toMatchObject({ ok: true });

    expect(
      await ctx.app.adminResolveStage(ctx.managerSessionId, {
        projectId: created.project.id,
        stageIndex: 0,
        decision: "confirm",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    const confirmed = await ctx.app.adminResolveStage(ctx.adminSessionId, {
      projectId: created.project.id,
      stageIndex: 0,
      decision: "confirm",
    });
    expect(confirmed).toMatchObject({
      ok: true,
      project: {
        stages: expect.arrayContaining([
          expect.objectContaining({ index: 0, status: "已完成" }),
          expect.objectContaining({ index: 1, status: "待處理" }),
        ]),
      },
    });

    const tasks = await ctx.app.listMyProductionTasks(ctx.annSessionId, {
      type: "dev",
    });
    expect(tasks).toMatchObject({
      ok: true,
      tasks: [expect.objectContaining({ projectCode: "WS-300", stageIndex: 1 })],
    });

    const summary = await ctx.app.getProductionHomeSummary(ctx.adminSessionId, {
      type: "dev",
    });
    expect(summary).toMatchObject({
      ok: true,
      summary: { total: 1, waitingConfirm: 0, needFix: 0 },
    });

    const byCategory = await ctx.app.listProductionProjects(ctx.annSessionId, {
      type: "dev",
      category: "其他",
    });
    expect(byCategory).toMatchObject({
      ok: true,
      projects: [expect.objectContaining({ code: "WS-300" })],
    });

    const setHandler = await ctx.app.setProductionStageHandler(
      ctx.adminSessionId,
      {
        projectId: created.project.id,
        stageIndex: 1,
        handlerAccountId: ctx.coeyId,
      },
    );
    expect(setHandler).toMatchObject({
      ok: true,
      project: {
        stages: expect.arrayContaining([
          expect.objectContaining({
            index: 1,
            handlerAccountId: ctx.coeyId,
          }),
        ]),
      },
    });

    expect(
      await ctx.app.setProductionStageHandler(ctx.annSessionId, {
        projectId: created.project.id,
        stageIndex: 1,
        handlerAccountId: ctx.annId,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});
