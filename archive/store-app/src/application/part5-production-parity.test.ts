import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { DEV_STAGES } from "./production-domain";
import { createMemoryFileStorage, createProductionApi } from "./production-api";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

async function boot(db: Db) {
  const fileStorage = createMemoryFileStorage();
  const app = createStoreWorkFlowApp({ db });
  // Replace production API with memory storage for file tests via direct API
  await app.seedSystemAdmin({
    loginName: "admin",
    password: "Admin123!",
    displayName: "系統管理員",
  });
  const admin = await app.login({ loginName: "admin", password: "Admin123!" });
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
  const manager = await app.login({
    loginName: "manager",
    password: "Manager123!",
  });
  const ann = await app.login({ loginName: "ann", password: "Staff123!" });
  if (!manager.ok || !ann.ok) throw new Error("login");

  const handlers = await app.listPersonalHandlers(admin.sessionId);
  if (!handlers.ok) throw new Error("handlers");
  const annId = handlers.handlers.find((h) => h.displayName === "Ann")!.accountId;

  const prod = createProductionApi({
    db,
    now: () => new Date(),
    getSession: (id) => app.getSession(id),
    fileStorage,
  });

  return {
    app,
    prod,
    adminSessionId: admin.sessionId,
    managerSessionId: manager.sessionId,
    annSessionId: ann.sessionId,
    annId,
  };
}

describe("Part 5 — production parity", () => {
  let memoryServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeEach(async () => {
    memoryServer = await MongoMemoryServer.create();
    client = new MongoClient(memoryServer.getUri());
    await client.connect();
    db = client.db("part5-test");
  });

  afterEach(async () => {
    await client.close();
    await memoryServer.stop();
  });

  it("admin 可編輯／暫停／取消；鎖定後不可推進；可 CSV 匯出", async () => {
    const ctx = await boot(db);
    const created = await ctx.prod.createProductionProject(ctx.adminSessionId, {
      type: "dev",
      code: "P5-1",
      name: "測試",
      category: "其他",
      stageHandlerIds: Array.from({ length: DEV_STAGES.length }, () => ctx.annId),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await ctx.prod.editProductionProject(ctx.adminSessionId, {
      projectId: created.project.id,
      code: "P5-1A",
      name: "測試改",
      category: "成人保暖衣",
      description: "說明",
      dueDate: "2026-12-01",
    });
    expect(edited).toMatchObject({
      ok: true,
      project: { code: "P5-1A", name: "測試改", category: "成人保暖衣" },
    });

    expect(
      await ctx.prod.editProductionProject(ctx.managerSessionId, {
        projectId: created.project.id,
        code: "X",
        name: "Y",
        category: "其他",
      }),
    ).toEqual({ ok: false, error: "forbidden" });

    const paused = await ctx.prod.setProductionProjectLifecycle(
      ctx.adminSessionId,
      { projectId: created.project.id, status: "暫停", reason: "等布料" },
    );
    expect(paused).toMatchObject({
      ok: true,
      project: { status: "暫停", statusReason: "等布料" },
    });

    expect(
      await ctx.prod.updateProductionStage(ctx.annSessionId, {
        projectId: created.project.id,
        stageIndex: 0,
        status: "進行中",
      }),
    ).toEqual({ ok: false, error: "project_locked" });

    await ctx.prod.setProductionProjectLifecycle(ctx.adminSessionId, {
      projectId: created.project.id,
      status: "進行中",
      reason: "恢復",
    });

    const csv = await ctx.prod.exportProductionProjectsCsv(ctx.adminSessionId, {
      type: "dev",
    });
    expect(csv.ok).toBe(true);
    if (csv.ok) {
      expect(csv.csv).toContain("P5-1A");
      expect(csv.csv.split("\n")[0]).toContain("編號");
    }
    expect(
      await ctx.prod.exportProductionProjectsCsv(ctx.managerSessionId, {
        type: "dev",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("留言／@提及／移除；檔案多版本", async () => {
    const ctx = await boot(db);
    const created = await ctx.prod.createProductionProject(ctx.adminSessionId, {
      type: "dev",
      code: "P5-2",
      name: "留言案",
      category: "其他",
      stageHandlerIds: Array.from({ length: DEV_STAGES.length }, () => ctx.annId),
    });
    if (!created.ok) throw new Error("create");

    const comment = await ctx.prod.addProductionComment(ctx.managerSessionId, {
      projectId: created.project.id,
      text: "@Ann 請跟進打版尺寸",
    });
    expect(comment).toMatchObject({
      ok: true,
      comment: { text: "@Ann 請跟進打版尺寸" },
    });

    const mentions = await ctx.prod.listMyMentions(ctx.annSessionId, {
      type: "dev",
    });
    expect(mentions).toMatchObject({
      ok: true,
      mentions: [expect.objectContaining({ projectCode: "P5-2" })],
    });

    if (!comment.ok) return;
    expect(
      await ctx.prod.removeProductionComment(ctx.annSessionId, {
        commentId: comment.comment.id,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await ctx.prod.removeProductionComment(ctx.adminSessionId, {
        commentId: comment.comment.id,
      }),
    ).toEqual({ ok: true });

    const listedComments = await ctx.prod.listProductionComments(
      ctx.annSessionId,
      { projectId: created.project.id },
    );
    expect(listedComments.ok).toBe(true);
    if (listedComments.ok) {
      expect(listedComments.comments.every((c) => !c.removed)).toBe(true);
    }

    const v1 = await ctx.prod.uploadProductionFile(ctx.annSessionId, {
      projectId: created.project.id,
      logicalName: "規格單",
      fileName: "spec-v1.pdf",
      contentType: "application/pdf",
      dataBase64: Buffer.from("v1").toString("base64"),
    });
    expect(v1).toMatchObject({
      ok: true,
      file: { version: 1, isLatest: true, logicalName: "規格單" },
    });

    const v2 = await ctx.prod.uploadProductionFile(ctx.adminSessionId, {
      projectId: created.project.id,
      logicalName: "規格單",
      fileName: "spec-v2.pdf",
      contentType: "application/pdf",
      dataBase64: Buffer.from("v2").toString("base64"),
    });
    expect(v2).toMatchObject({
      ok: true,
      file: { version: 2, isLatest: true },
    });

    const files = await ctx.prod.listProductionFiles(ctx.managerSessionId, {
      projectId: created.project.id,
    });
    expect(files.ok).toBe(true);
    if (files.ok) {
      expect(files.files).toHaveLength(2);
      expect(files.files.filter((f) => f.isLatest)).toHaveLength(1);
    }

    if (!v2.ok) return;
    const content = await ctx.prod.getProductionFileContent(ctx.annSessionId, {
      fileId: v2.file.id,
    });
    expect(content).toMatchObject({
      ok: true,
      dataBase64: Buffer.from("v2").toString("base64"),
    });
  });
});
