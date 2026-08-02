import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db, now: () => Date) {
  const app = createStoreWorkFlowApp({ db, now });
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

  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager login failed");

  return { app, managerSessionId: managerLogin.sessionId };
}

describe("門市工作流程應用服務 — 恆常工作", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let current: Date;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("store-work-flow-test");
    current = new Date("2026-08-03T10:00:00+08:00");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("可建立每日恆常範本並為單位產生實例", async () => {
    const { app, managerSessionId } = await boot(db, () => current);

    const template = await app.createRecurringTemplate(managerSessionId, {
      title: "每日開舖檢查",
      content: "檢查門鎖與燈光",
      units: ["觀塘"],
      priority: "normal",
      recurrence: "daily",
      sortOrder: 1,
    });
    expect(template).toMatchObject({
      ok: true,
      template: {
        title: "每日開舖檢查",
        recurrence: "daily",
        active: true,
      },
    });

    const generated = await app.generateRecurringForDate(managerSessionId, {
      date: current,
    });
    expect(generated).toMatchObject({ ok: true, createdCount: 1 });

    const staffLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!staffLogin.ok) throw new Error("staff login failed");

    const today = await app.getTodayWork(staffLogin.sessionId);
    expect(today).toMatchObject({
      ok: true,
      works: [
        expect.objectContaining({
          type: "recurring",
          title: "每日開舖檢查",
          status: "pending",
        }),
      ],
    });
  });

  it("未完成時跨日延續同一筆，不重複產生", async () => {
    const { app, managerSessionId } = await boot(db, () => current);

    await app.createRecurringTemplate(managerSessionId, {
      title: "清潔指定位置",
      content: "清潔",
      units: ["觀塘"],
      priority: "normal",
      recurrence: "daily",
    });

    await app.generateRecurringForDate(managerSessionId, { date: current });
    const staffLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!staffLogin.ok) throw new Error("staff login failed");
    const day1 = await app.getTodayWork(staffLogin.sessionId);
    if (!day1.ok) throw new Error("day1 failed");
    const workId = day1.works[0]!.id;

    current = new Date("2026-08-04T10:00:00+08:00");
    const again = await app.generateRecurringForDate(managerSessionId, {
      date: current,
    });
    expect(again).toMatchObject({ ok: true, createdCount: 0 });

    const day2 = await app.getTodayWork(staffLogin.sessionId);
    expect(day2).toMatchObject({
      ok: true,
      works: [
        expect.objectContaining({
          id: workId,
          status: "pending",
        }),
      ],
      summary: expect.objectContaining({ overdue: 1 }),
    });
  });

  it("完成後下一日可再產生新實例；可與突發工作並列", async () => {
    const { app, managerSessionId } = await boot(db, () => current);

    await app.createRecurringTemplate(managerSessionId, {
      title: "檢查貨品存量",
      content: "存量",
      units: ["觀塘"],
      priority: "normal",
      recurrence: "daily",
    });
    await app.createAdhocWork(managerSessionId, {
      title: "臨時點算",
      content: "點算指定貨品",
      units: ["觀塘"],
      priority: "important",
    });

    await app.generateRecurringForDate(managerSessionId, { date: current });
    const staffLogin = await app.login({
      loginName: "kt.a",
      password: "Staff123!",
    });
    if (!staffLogin.ok) throw new Error("staff login failed");

    const before = await app.getTodayWork(staffLogin.sessionId);
    if (!before.ok) throw new Error("before failed");
    expect(before.works).toHaveLength(2);

    const recurring = before.works.find((work) => work.type === "recurring");
    expect(recurring).toBeTruthy();
    await app.completeWork(staffLogin.sessionId, { workId: recurring!.id });

    current = new Date("2026-08-04T10:00:00+08:00");
    const generated = await app.generateRecurringForDate(managerSessionId, {
      date: current,
    });
    expect(generated).toMatchObject({ ok: true, createdCount: 1 });

    const after = await app.getTodayWork(staffLogin.sessionId);
    if (!after.ok) throw new Error("after failed");
    const pendingRecurring = after.works.filter(
      (work) => work.type === "recurring" && work.status === "pending",
    );
    expect(pendingRecurring).toHaveLength(1);
    expect(pendingRecurring[0]!.id).not.toBe(recurring!.id);
  });
});
