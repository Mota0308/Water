import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createStoreWorkFlowApp } from "./store-work-flow-app";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

describe("門市工作流程應用服務 — 附件與備註", () => {
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

  it("必填附件與備註未滿足時拒絕完成；滿足後可完成並供本單位／管理層查看", async () => {
    const { app, managerSessionId } = await boot(db);
    const created = await app.createAdhocWork(managerSessionId, {
      title: "需證明工作",
      content: "請上載照片",
      units: ["觀塘"],
      priority: "important",
      attachmentRequirement: "required",
      noteRequirement: "required",
    });
    if (!created.ok) throw new Error("create failed");
    const workId = created.works[0]!.id;

    const kt = await app.login({ loginName: "kt.a", password: "Staff123!" });
    if (!kt.ok) throw new Error("kt");

    expect(await app.completeWork(kt.sessionId, { workId })).toEqual({
      ok: false,
      error: "attachment_required",
    });

    expect(
      await app.completeWork(kt.sessionId, {
        workId,
        note: "已完成",
        attachments: [
          {
            fileName: "proof.exe",
            contentType: "application/octet-stream",
            dataBase64: "AAA",
          },
        ],
      }),
    ).toEqual({ ok: false, error: "invalid_attachment_type" });

    expect(
      await app.completeWork(kt.sessionId, {
        workId,
        attachments: [
          {
            fileName: "proof.png",
            contentType: "image/png",
            dataBase64: PNG_BASE64,
          },
        ],
      }),
    ).toEqual({ ok: false, error: "note_required" });

    expect(
      await app.completeWork(kt.sessionId, {
        workId,
        note: "已完成並上載",
        attachments: [
          {
            fileName: "proof.png",
            contentType: "image/png",
            dataBase64: PNG_BASE64,
          },
        ],
      }),
    ).toEqual({ ok: true });

    const listed = await app.listWorkAttachments(kt.sessionId, { workId });
    expect(listed).toMatchObject({
      ok: true,
      attachments: [
        {
          fileName: "proof.png",
          contentType: "image/png",
          dataBase64: PNG_BASE64,
        },
      ],
    });

    const managerListed = await app.listWorkAttachments(managerSessionId, {
      workId,
    });
    expect(managerListed).toMatchObject({
      ok: true,
      attachments: [{ dataBase64: PNG_BASE64 }],
    });

    const tm = await app.login({ loginName: "tm.a", password: "Staff123!" });
    if (!tm.ok) throw new Error("tm");
    expect(await app.listWorkAttachments(tm.sessionId, { workId })).toEqual({
      ok: false,
      error: "forbidden",
    });

    const readonly = await app.getUnitWorkReadonly(tm.sessionId, {
      unit: "觀塘",
    });
    expect(readonly.ok).toBe(true);
    if (readonly.ok) {
      expect(JSON.stringify(readonly)).not.toContain("proof.png");
      expect(JSON.stringify(readonly)).not.toContain(PNG_BASE64);
    }
  });
});
