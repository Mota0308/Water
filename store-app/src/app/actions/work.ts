"use server";

import { revalidatePath } from "next/cache";
import {
  FIXED_UNITS,
  type AttachmentRequirement,
  type FixedUnit,
  type NoteRequirement,
  type Recurrence,
  type WorkAttachmentInput,
  type WorkPriority,
} from "@/application/store-work-flow-app";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type WorkActionMessage = { error?: string; success?: string };

function selectedUnits(formData: FormData): FixedUnit[] {
  return formData
    .getAll("units")
    .map(String)
    .filter((unit): unit is FixedUnit =>
      (FIXED_UNITS as readonly string[]).includes(unit),
    );
}

function requirement(
  value: FormDataEntryValue | null,
  fallback: AttachmentRequirement,
): AttachmentRequirement {
  const raw = String(value ?? fallback);
  return raw === "optional" || raw === "required" || raw === "none"
    ? raw
    : fallback;
}

function noteRequirement(
  value: FormDataEntryValue | null,
): NoteRequirement {
  return String(value ?? "optional") === "required" ? "required" : "optional";
}

async function filesFromForm(
  formData: FormData,
  field = "attachments",
): Promise<WorkAttachmentInput[]> {
  const entries = formData.getAll(field);
  const attachments: WorkAttachmentInput[] = [];
  for (const entry of entries) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const buffer = Buffer.from(await entry.arrayBuffer());
    attachments.push({
      fileName: entry.name,
      contentType: entry.type || "application/octet-stream",
      dataBase64: buffer.toString("base64"),
    });
  }
  return attachments;
}

export async function createAdhocWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }

  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const app = await getStoreWorkFlowApp();
  const result = await app.createAdhocWork(sessionId, {
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    units: selectedUnits(formData),
    priority: String(formData.get("priority") ?? "normal") as WorkPriority,
    dueAt: dueRaw ? new Date(dueRaw) : undefined,
    attachmentRequirement: requirement(
      formData.get("attachmentRequirement"),
      "none",
    ),
    noteRequirement: noteRequirement(formData.get("noteRequirement")),
    sensitive: formData.get("sensitive") === "on",
  });

  if (!result.ok) {
    return { error: "建立突發工作失敗（需要管理層權限與至少一個單位）" };
  }

  revalidatePath("/");
  revalidatePath("/work/new");
  return { success: `已建立 ${result.works.length} 項突發工作` };
}

export async function createDailySettlementAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.createDailySettlementWork(sessionId, {
    title: String(formData.get("title") ?? "每日結算工作").trim(),
    content: String(formData.get("content") ?? "等待第二部分日結模組連接").trim(),
    priority: String(formData.get("priority") ?? "important") as WorkPriority,
  });

  if (!result.ok) {
    return { error: "建立每日結算工作失敗" };
  }

  revalidatePath("/");
  return { success: `已為四間門市建立每日結算預留工作（${result.works.length}）` };
}

export async function createRecurringAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.createRecurringTemplate(sessionId, {
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    units: selectedUnits(formData),
    priority: String(formData.get("priority") ?? "normal") as WorkPriority,
    recurrence: String(formData.get("recurrence") ?? "daily") as Recurrence,
    attachmentRequirement: requirement(
      formData.get("attachmentRequirement"),
      "none",
    ),
    noteRequirement: noteRequirement(formData.get("noteRequirement")),
    sensitive: formData.get("sensitive") === "on",
  });

  if (!result.ok) {
    return { error: "建立恆常工作失敗（需要管理層權限與至少一個單位）" };
  }

  revalidatePath("/");
  revalidatePath("/work/recurring");
  return { success: `已建立恆常工作「${result.template.title}」` };
}

export async function completeWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }
  const app = await getStoreWorkFlowApp();
  const result = await app.completeWork(sessionId, {
    workId: String(formData.get("workId") ?? ""),
    note: String(formData.get("note") ?? ""),
    attachments: await filesFromForm(formData),
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      attachment_required: "此工作需要上載附件",
      note_required: "此工作需要完成備註",
      invalid_attachment_type: "附件只接受圖片或 PDF",
      reserved_for_part2: "每日結算尚未連接日結模組",
      already_completed: "此工作已完成",
      forbidden: "沒有權限完成此工作",
      not_found: "找不到工作",
    };
    return { error: messages[result.error] ?? "完成工作失敗" };
  }

  revalidatePath("/");
  return { success: "已完成" };
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

export async function reopenWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "請填寫重新開啟原因" };
  }
  const app = await getStoreWorkFlowApp();
  const result = await app.reopenWork(sessionId, {
    workId: String(formData.get("workId") ?? ""),
    reason,
  });
  if (!result.ok) {
    return { error: "重新開啟失敗（需要管理層權限，且工作須為已完成）" };
  }
  revalidatePath("/");
  revalidatePath(`/work/${String(formData.get("workId") ?? "")}`);
  return { success: "已重新開啟，原完成紀錄已保留" };
}

export async function cancelAdhocWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }
  const app = await getStoreWorkFlowApp();
  const result = await app.cancelAdhocWork(sessionId, {
    workId: String(formData.get("workId") ?? ""),
  });
  if (!result.ok) {
    return { error: "取消突發工作失敗" };
  }
  revalidatePath("/");
  return { success: "已取消該突發工作" };
}

export async function deactivateRecurringAction(
  formData: FormData,
): Promise<void> {
  const sessionId = await readSessionId();
  if (!sessionId) return;
  const app = await getStoreWorkFlowApp();
  await app.deactivateRecurringTemplate(sessionId, {
    templateId: String(formData.get("templateId") ?? ""),
  });
  revalidatePath("/work/recurring");
  revalidatePath("/");
}

export async function updateWorkAction(
  _prev: WorkActionMessage,
  formData: FormData,
): Promise<WorkActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const priority =
    priorityRaw === "normal" ||
    priorityRaw === "important" ||
    priorityRaw === "urgent"
      ? priorityRaw
      : undefined;
  const app = await getStoreWorkFlowApp();
  const result = await app.updateWork(sessionId, {
    workId: String(formData.get("workId") ?? ""),
    title: String(formData.get("title") ?? "").trim() || undefined,
    content: String(formData.get("content") ?? "").trim() || undefined,
    priority,
  });
  if (!result.ok) {
    return { error: "編輯工作失敗" };
  }
  revalidatePath("/");
  revalidatePath(`/work/${String(formData.get("workId") ?? "")}`);
  return { success: "已更新工作" };
}
