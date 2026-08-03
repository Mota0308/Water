import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
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
  const ann = await app.createAccount(admin.sessionId, {
    loginName: "ann",
    password: "Staff123!",
    displayName: "Ann",
    role: "personal",
    fixedUnit: "觀塘",
  });
  const ben = await app.createAccount(admin.sessionId, {
    loginName: "ben",
    password: "Staff123!",
    displayName: "Ben",
    role: "personal",
    fixedUnit: "觀塘",
  });
  const carl = await app.createAccount(admin.sessionId, {
    loginName: "carl",
    password: "Staff123!",
    displayName: "Carl",
    role: "personal",
    fixedUnit: "屯門",
  });
  if (!ann.ok || !ben.ok || !carl.ok) throw new Error("staff");

  const manager = await app.login({
    loginName: "manager",
    password: "Manager123!",
  });
  const annLogin = await app.login({ loginName: "ann", password: "Staff123!" });
  const benLogin = await app.login({ loginName: "ben", password: "Staff123!" });
  const carlLogin = await app.login({
    loginName: "carl",
    password: "Staff123!",
  });
  if (!manager.ok || !annLogin.ok || !benLogin.ok || !carlLogin.ok) {
    throw new Error("logins");
  }

  return {
    app,
    adminSessionId: admin.sessionId,
    managerSessionId: manager.sessionId,
    annSessionId: annLogin.sessionId,
    benSessionId: benLogin.sessionId,
    carlSessionId: carlLogin.sessionId,
    annId: ann.account.id,
    benId: ben.account.id,
    carlId: carl.account.id,
  };
}

describe("Part 4 — 關注地區與工作負責人", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("part4-test");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("personal 可設定關注地區；今日列表依關注篩選；不擴大完成權", async () => {
    const ctx = await boot(db);

    const defaults = await ctx.app.getSession(ctx.annSessionId);
    expect(defaults?.watchedUnits).toEqual(["觀塘"]);

    expect(
      await ctx.app.updateWatchedUnits(ctx.annSessionId, {
        units: ["觀塘", "屯門"],
      }),
    ).toMatchObject({ ok: true, watchedUnits: ["觀塘", "屯門"] });

    expect(
      await ctx.app.updateWatchedUnits(ctx.annSessionId, { units: [] }),
    ).toMatchObject({ ok: false, error: "units_required" });

    await ctx.app.createAdhocWork(ctx.managerSessionId, {
      title: "屯門任務",
      content: "內容",
      units: ["屯門"],
      priority: "normal",
    });
    await ctx.app.createAdhocWork(ctx.managerSessionId, {
      title: "灣仔任務",
      content: "內容",
      units: ["灣仔"],
      priority: "normal",
    });

    const today = await ctx.app.getTodayWork(ctx.annSessionId);
    expect(today.ok).toBe(true);
    if (!today.ok) return;
    const titles = today.works.map((w) => w.title).sort();
    expect(titles).toEqual(["屯門任務"]);

    const tmWork = today.works.find((w) => w.title === "屯門任務")!;
    expect(
      await ctx.app.getWork(ctx.annSessionId, { workId: tmWork.id }),
    ).toMatchObject({ ok: true, work: { title: "屯門任務" } });
    expect(
      await ctx.app.completeWork(ctx.annSessionId, { workId: tmWork.id }),
    ).toEqual({ ok: false, error: "forbidden" });

    expect(
      await ctx.app.completeWork(ctx.carlSessionId, { workId: tmWork.id }),
    ).toEqual({ ok: true });
  });

  it("突發可每單位指定負責人；同區非負責人可見但不可完成；可改派", async () => {
    const ctx = await boot(db);

    const created = await ctx.app.createAdhocWork(ctx.managerSessionId, {
      title: "指派任務",
      content: "內容",
      units: ["觀塘", "屯門"],
      priority: "important",
      handlersByUnit: {
        觀塘: ctx.annId,
        屯門: ctx.carlId,
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const kt = created.works.find((w) => w.unit === "觀塘")!;
    const tm = created.works.find((w) => w.unit === "屯門")!;
    expect(kt.handlerAccountId).toBe(ctx.annId);
    expect(kt.handlerDisplayName).toBe("Ann");
    expect(tm.handlerAccountId).toBe(ctx.carlId);

    expect(
      await ctx.app.createAdhocWork(ctx.managerSessionId, {
        title: "錯人",
        content: "x",
        units: ["觀塘"],
        priority: "normal",
        handlersByUnit: { 觀塘: ctx.carlId },
      }),
    ).toMatchObject({ ok: false, error: "invalid_handler" });

    const benToday = await ctx.app.getTodayWork(ctx.benSessionId);
    expect(benToday.ok).toBe(true);
    if (!benToday.ok) return;
    expect(benToday.works.some((w) => w.id === kt.id)).toBe(true);

    expect(
      await ctx.app.completeWork(ctx.benSessionId, { workId: kt.id }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await ctx.app.completeWork(ctx.annSessionId, { workId: kt.id }),
    ).toEqual({ ok: true });

    const reassigned = await ctx.app.setWorkHandler(ctx.managerSessionId, {
      workId: tm.id,
      handlerAccountId: null,
    });
    expect(reassigned).toMatchObject({
      ok: true,
      work: { handlerAccountId: null },
    });

    expect(
      await ctx.app.setWorkHandler(ctx.annSessionId, {
        workId: tm.id,
        handlerAccountId: ctx.carlId,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("恆常模板可帶每單位負責人；每日結算不帶負責人", async () => {
    const ctx = await boot(db);
    const template = await ctx.app.createRecurringTemplate(
      ctx.managerSessionId,
      {
        title: "恆常指派",
        content: "掃店",
        units: ["觀塘"],
        priority: "normal",
        recurrence: "daily",
        handlersByUnit: { 觀塘: ctx.benId },
      },
    );
    expect(template).toMatchObject({
      ok: true,
      template: {
        handlersByUnit: { 觀塘: ctx.benId },
      },
    });

    const generated = await ctx.app.generateRecurringForDate(
      ctx.managerSessionId,
      { date: new Date() },
    );
    expect(generated.ok).toBe(true);

    const today = await ctx.app.getTodayWork(ctx.benSessionId);
    expect(today.ok).toBe(true);
    if (!today.ok) return;
    const recurring = today.works.find((w) => w.title === "恆常指派");
    expect(recurring?.handlerAccountId).toBe(ctx.benId);

    const settlement = await ctx.app.createDailySettlementWork(
      ctx.managerSessionId,
      {
        title: "結算",
        content: "x",
        priority: "important",
      },
    );
    expect(settlement.ok).toBe(true);
    if (!settlement.ok) return;
    expect(
      settlement.works.every((w) => w.handlerAccountId === null),
    ).toBe(true);
  });
});
