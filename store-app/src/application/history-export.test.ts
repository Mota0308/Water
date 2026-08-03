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
  const managerLogin = await app.login({
    loginName: "manager.one",
    password: "Manager123!",
  });
  if (!managerLogin.ok) throw new Error("manager");
  return { app, managerSessionId: managerLogin.sessionId };
}

describe("門市工作流程應用服務 — 歷史統計匯出", () => {
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

  it("管理層可篩選歷史、看人員統計並匯出 CSV；個人不可", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "清潔",
      content: "清潔區",
      units: ["觀塘"],
      priority: "urgent",
    });
    if (!created.ok) throw new Error("create");
    const kt = await app.login({ loginName: "kt.a", password: "Staff123!" });
    if (!kt.ok) throw new Error("kt");
    await app.completeWork(kt.sessionId, { workId: created.works[0]!.id });

    const history = await app.searchWorkHistory(managerSessionId, {
      unit: "觀塘",
      status: "completed",
      priority: "urgent",
    });
    expect(history).toMatchObject({
      ok: true,
      works: [expect.objectContaining({ title: "清潔", status: "completed" })],
    });

    const overdueFilter = await app.searchWorkHistory(managerSessionId, {
      overdueOnly: true,
    });
    expect(overdueFilter.ok).toBe(true);
    if (overdueFilter.ok) {
      expect(
        overdueFilter.works.every(
          (work) =>
            work.dueAt &&
            ((work.status === "pending" &&
              work.dueAt.getTime() < Date.now()) ||
              (work.status === "completed" &&
                work.completedAt &&
                work.completedAt.getTime() > work.dueAt.getTime())),
        ),
      ).toBe(true);
    }

    const stats = await app.getStaffStats(managerSessionId, { unit: "觀塘" });
    expect(stats).toMatchObject({
      ok: true,
      stats: [
        expect.objectContaining({
          displayName: "觀塘甲",
          completedCount: 1,
        }),
      ],
    });

    const csv = await app.exportWorkHistoryCsv(managerSessionId, {
      unit: "觀塘",
    });
    expect(csv).toMatchObject({ ok: true });
    if (csv.ok) {
      expect(csv.csv).toContain("清潔");
      expect(csv.csv).toContain("觀塘甲");
      expect(csv.csv.split("\n")[0]).toContain("title");
    }

    expect(await app.searchWorkHistory(kt.sessionId, {})).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await app.getStaffStats(kt.sessionId, {})).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await app.exportWorkHistoryCsv(kt.sessionId, {})).toEqual({
      ok: false,
      error: "forbidden",
    });

    const mine = await app.listMyCompletions(kt.sessionId, {});
    expect(mine).toMatchObject({
      ok: true,
      completions: [
        expect.objectContaining({
          title: "清潔",
          unit: "觀塘",
          onTime: true,
        }),
      ],
    });

    expect(await app.listMyCompletions(managerSessionId, {})).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
