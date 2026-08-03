import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db, now: () => Date, idleTimeoutMs = 30 * 60 * 1000) {
  const app = createStoreWorkFlowApp({ db, now, idleTimeoutMs });
  await app.seedSystemAdmin({
    loginName: "admin",
    password: "Secret123!",
    displayName: "系統管理員",
  });
  const adminLogin = await app.login({
    loginName: "admin",
    password: "Secret123!",
  });
  if (!adminLogin.ok) throw new Error("admin");
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
  if (!managerLogin.ok) throw new Error("manager");
  return { app, managerSessionId: managerLogin.sessionId };
}

describe("門市工作流程應用服務 — 敏感排序閒置種子", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let current: Date;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("store-work-flow-test");
    current = new Date("2026-08-03T12:00:00+08:00");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("敏感工作對其他單位隱藏；今日清單依逾期與優先排序", async () => {
    const { app, managerSessionId } = await boot(db, () => current);

    await app.createAdhocWork(managerSessionId, {
      title: "一般突發",
      content: "一般",
      units: ["觀塘"],
      priority: "normal",
    });
    await app.createAdhocWork(managerSessionId, {
      title: "緊急突發",
      content: "緊急",
      units: ["觀塘"],
      priority: "urgent",
    });
    await app.createAdhocWork(managerSessionId, {
      title: "逾期工作",
      content: "逾期",
      units: ["觀塘"],
      priority: "normal",
      dueAt: new Date("2026-08-02T18:00:00+08:00"),
    });
    await app.createAdhocWork(managerSessionId, {
      title: "敏感內部",
      content: "機密",
      units: ["觀塘"],
      priority: "important",
      sensitive: true,
    });

    const kt = await app.login({ loginName: "kt.a", password: "Staff123!" });
    if (!kt.ok) throw new Error("kt");
    const today = await app.getTodayWork(kt.sessionId);
    expect(today.ok).toBe(true);
    if (!today.ok) return;
    expect(today.works.map((work) => work.title)).toEqual([
      "逾期工作",
      "緊急突發",
      "敏感內部",
      "一般突發",
    ]);

    const tm = await app.login({ loginName: "tm.a", password: "Staff123!" });
    if (!tm.ok) throw new Error("tm");
    const readonly = await app.getUnitWorkReadonly(tm.sessionId, {
      unit: "觀塘",
    });
    expect(readonly.ok).toBe(true);
    if (!readonly.ok) return;
    expect(readonly.works.map((work) => work.title)).not.toContain("敏感內部");
    expect(readonly.summary.total).toBe(3);

    const progress = await app.listUnitProgress(tm.sessionId);
    expect(progress.ok).toBe(true);
    if (!progress.ok) return;
    const ktProgress = progress.units.find((unit) => unit.unit === "觀塘");
    expect(ktProgress?.total).toBe(3);
  });

  it("閒置逾時後會話失效；示範種子可載入恆常工作", async () => {
    const { app } = await boot(db, () => current, 60_000);
    const kt = await app.login({ loginName: "kt.a", password: "Staff123!" });
    if (!kt.ok) throw new Error("kt");

    current = new Date(current.getTime() + 61_000);
    expect(await app.getSession(kt.sessionId)).toBeNull();
    expect(await app.requireSession(kt.sessionId)).toEqual({
      ok: false,
      error: "unauthenticated",
    });

    const admin = await app.login({
      loginName: "admin",
      password: "Secret123!",
    });
    if (!admin.ok) throw new Error("admin");
    const seeded = await app.seedDemoRecurringTemplates(admin.sessionId);
    expect(seeded).toMatchObject({ ok: true });
    if (seeded.ok) {
      expect(seeded.createdCount).toBeGreaterThanOrEqual(4);
    }
  });
});
