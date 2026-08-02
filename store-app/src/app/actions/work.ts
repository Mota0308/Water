"use server";

import { revalidatePath } from "next/cache";
import {
  FIXED_UNITS,
  type FixedUnit,
  type WorkPriority,
} from "@/application/store-work-flow-app";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type WorkActionMessage = { error?: string; success?: string };

export async function createAdhocWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }

  const units = formData
    .getAll("units")
    .map(String)
    .filter((unit): unit is FixedUnit =>
      (FIXED_UNITS as readonly string[]).includes(unit),
    );

  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const app = await getStoreWorkFlowApp();
  const result = await app.createAdhocWork(sessionId, {
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    units,
    priority: String(formData.get("priority") ?? "normal") as WorkPriority,
    dueAt: dueRaw ? new Date(dueRaw) : undefined,
  });

  if (!result.ok) {
    return { error: "建立突發工作失敗（需要管理層權限與至少一個單位）" };
  }

  revalidatePath("/");
  revalidatePath("/work/new");
  return { success: `已建立 ${result.works.length} 項突發工作` };
}

export async function completeWorkAction(formData: FormData): Promise<void> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return;
  }
  const app = await getStoreWorkFlowApp();
  await app.completeWork(sessionId, {
    workId: String(formData.get("workId") ?? ""),
  });
  revalidatePath("/");
}

export async function cancelCompletionAction(formData: FormData): Promise<void> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return;
  }
  const app = await getStoreWorkFlowApp();
  await app.cancelOwnCompletion(sessionId, {
    workId: String(formData.get("workId") ?? ""),
  });
  revalidatePath("/");
}
