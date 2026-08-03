"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  HANDLER_STAGE_STATUSES,
  type ProductionProjectType,
  type StageStatus,
  stagesForType,
} from "@/application/production-domain";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type ProductionActionMessage = { error?: string; success?: string };

function modulePath(type: ProductionProjectType): string {
  return type === "dev" ? "/production" : "/replenishment";
}

function revalidateProduction(type: ProductionProjectType, projectId?: string) {
  const base = modulePath(type);
  revalidatePath(base);
  revalidatePath(`${base}/list`);
  revalidatePath(`${base}/my-tasks`);
  revalidatePath(`${base}/new`);
  if (projectId) revalidatePath(`${base}/projects/${projectId}`);
}

export async function createProductionProjectAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };

  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  if (type !== "dev" && type !== "rep") {
    return { error: "項目類型無效" };
  }

  const stageNames = stagesForType(type);
  const stageHandlerIds = stageNames.map((_, i) => {
    const raw = String(formData.get(`stageHandler_${i}`) ?? "").trim();
    return raw || null;
  });

  const ownerRaw = String(formData.get("ownerAccountId") ?? "").trim();
  const app = await getStoreWorkFlowApp();
  const result = await app.createProductionProject(sessionId, {
    type,
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    ownerAccountId: ownerRaw || undefined,
    dueDate: String(formData.get("dueDate") ?? "").trim() || undefined,
    stageHandlerIds,
  });

  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
        return { error: "只有系統管理員可以建立項目" };
      case "invalid_handler":
        return { error: "經手人必須為啟用中的個人賬號" };
      case "stage_count_mismatch":
        return { error: "階段經手人數量不符" };
      case "unauthenticated":
        return { error: "請重新登入" };
      default:
        return { error: "請填寫產品編號、名稱與分類" };
    }
  }

  revalidateProduction(type, result.project.id);
  redirect(`${modulePath(type)}/projects/${result.project.id}`);
}

export async function updateProductionStageAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };

  const projectId = String(formData.get("projectId") ?? "");
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const stageIndex = Number(formData.get("stageIndex"));
  const status = String(formData.get("status") ?? "") as StageStatus;
  const content = String(formData.get("content") ?? "");

  if (!HANDLER_STAGE_STATUSES.includes(status) && status !== "待處理") {
    // admin may set broader statuses via same action
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.updateProductionStage(sessionId, {
    projectId,
    stageIndex,
    status,
    content: content || undefined,
  });

  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
      case "not_handler":
        return { error: "您沒有權限更新此階段" };
      case "not_current_stage":
        return { error: "目前尚未輪到此階段" };
      case "invalid_status":
        return { error: "狀態不允許" };
      case "not_found":
        return { error: "找不到項目" };
      case "project_locked":
        return { error: "項目已暫停或取消，無法更新階段" };
      default:
        return { error: "更新失敗" };
    }
  }

  revalidateProduction(type || result.project.type, projectId);
  return { success: "階段已更新" };
}

export async function setProductionStageHandlerAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };

  const projectId = String(formData.get("projectId") ?? "");
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const stageIndex = Number(formData.get("stageIndex"));
  const handlerAccountId = String(formData.get("handlerAccountId") ?? "").trim();

  const app = await getStoreWorkFlowApp();
  const result = await app.setProductionStageHandler(sessionId, {
    projectId,
    stageIndex,
    handlerAccountId,
  });

  if (!result.ok) {
    if (result.error === "forbidden") return { error: "只有系統管理員可更改經手人" };
    if (result.error === "invalid_handler") return { error: "經手人無效" };
    return { error: "更改經手人失敗" };
  }

  revalidateProduction(type || result.project.type, projectId);
  return { success: "經手人已更新" };
}

export async function adminResolveStageAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };

  const projectId = String(formData.get("projectId") ?? "");
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const stageIndex = Number(formData.get("stageIndex"));
  const decision = String(formData.get("decision") ?? "") as "confirm" | "return";
  const note = String(formData.get("note") ?? "").trim();

  if (decision !== "confirm" && decision !== "return") {
    return { error: "操作無效" };
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.adminResolveStage(sessionId, {
    projectId,
    stageIndex,
    decision,
    note: note || undefined,
  });

  if (!result.ok) {
    if (result.error === "forbidden") return { error: "只有系統管理員可確認階段" };
    if (result.error === "not_pending_confirm") {
      return { error: "此階段不是待確認狀態" };
    }
    return { error: "確認操作失敗" };
  }

  revalidateProduction(type || result.project.type, projectId);
  return {
    success: decision === "confirm" ? "已確認完成" : "已退回需修改",
  };
}

export async function editProductionProjectAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const projectId = String(formData.get("projectId") ?? "");
  const app = await getStoreWorkFlowApp();
  const result = await app.editProductionProject(sessionId, {
    projectId,
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    dueDate: String(formData.get("dueDate") ?? "").trim() || undefined,
  });
  if (!result.ok) {
    if (result.error === "forbidden") return { error: "只有系統管理員可編輯" };
    if (result.error === "not_editable") return { error: "已取消項目不可編輯" };
    return { error: "編輯失敗" };
  }
  revalidateProduction(type || result.project.type, projectId);
  return { success: "項目資料已更新" };
}

export async function setProductionLifecycleAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const projectId = String(formData.get("projectId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "暫停"
    | "已取消"
    | "進行中";
  const reason = String(formData.get("reason") ?? "").trim();
  const app = await getStoreWorkFlowApp();
  const result = await app.setProductionProjectLifecycle(sessionId, {
    projectId,
    status,
    reason,
  });
  if (!result.ok) {
    if (result.error === "forbidden") return { error: "只有系統管理員可操作" };
    if (result.error === "invalid_input") return { error: "請填寫原因" };
    return { error: "狀態更新失敗" };
  }
  revalidateProduction(type || result.project.type, projectId);
  return { success: `項目已設為${status}` };
}

export async function addProductionCommentAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const projectId = String(formData.get("projectId") ?? "");
  const parentId = String(formData.get("parentId") ?? "").trim();
  const app = await getStoreWorkFlowApp();
  const result = await app.addProductionComment(sessionId, {
    projectId,
    text: String(formData.get("text") ?? ""),
    parentId: parentId || undefined,
  });
  if (!result.ok) {
    if (result.error === "invalid_input") return { error: "請輸入留言內容" };
    return { error: "留言失敗" };
  }
  revalidateProduction(type, projectId);
  return { success: "留言已發表" };
}

export async function removeProductionCommentAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const projectId = String(formData.get("projectId") ?? "");
  const app = await getStoreWorkFlowApp();
  const result = await app.removeProductionComment(sessionId, {
    commentId: String(formData.get("commentId") ?? ""),
  });
  if (!result.ok) {
    if (result.error === "forbidden") return { error: "只有系統管理員可移除留言" };
    return { error: "移除失敗" };
  }
  revalidateProduction(type, projectId);
  return { success: "留言已移除" };
}

export async function uploadProductionFileAction(
  _prev: ProductionActionMessage,
  formData: FormData,
): Promise<ProductionActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };
  const type = String(formData.get("type") ?? "") as ProductionProjectType;
  const projectId = String(formData.get("projectId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "請選擇檔案" };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const logicalName =
    String(formData.get("logicalName") ?? "").trim() || file.name;
  const app = await getStoreWorkFlowApp();
  const result = await app.uploadProductionFile(sessionId, {
    projectId,
    logicalName,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    dataBase64: buffer.toString("base64"),
  });
  if (!result.ok) {
    if (result.error === "forbidden") return { error: "沒有上傳權限" };
    return { error: "上傳失敗" };
  }
  revalidateProduction(type, projectId);
  return { success: `已上傳 ${result.file.logicalName} v${result.file.version}` };
}
