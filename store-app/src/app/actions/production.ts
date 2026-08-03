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
