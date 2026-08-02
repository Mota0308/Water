"use server";

import { revalidatePath } from "next/cache";
import { FIXED_UNITS, type AccountRole, type FixedUnit } from "@/application/store-work-flow-app";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type ActionMessage = { error?: string; success?: string };

async function requireAdminSession() {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok || auth.session.role !== "system_admin") {
    return null;
  }
  return { app, sessionId: auth.session.sessionId };
}

export async function createAccountAction(
  _prev: ActionMessage,
  formData: FormData,
): Promise<ActionMessage> {
  const ctx = await requireAdminSession();
  if (!ctx) {
    return { error: "沒有權限" };
  }

  const role = String(formData.get("role") ?? "") as AccountRole;
  const fixedUnitRaw = String(formData.get("fixedUnit") ?? "");
  const fixedUnit = fixedUnitRaw
    ? (fixedUnitRaw as FixedUnit)
    : undefined;

  const result = await ctx.app.createAccount(ctx.sessionId, {
    loginName: String(formData.get("loginName") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    displayName: String(formData.get("displayName") ?? "").trim(),
    role,
    fixedUnit,
    jobTitle: String(formData.get("jobTitle") ?? "").trim() || undefined,
    department: String(formData.get("department") ?? "").trim() || undefined,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      forbidden: "沒有權限",
      unauthenticated: "請重新登入",
      invalid_unit: "固定單位不正確",
      fixed_unit_required: "個人賬號必須設定固定單位",
      login_name_taken: "登入名稱已被使用",
    };
    return { error: messages[result.error] ?? "建立失敗" };
  }

  revalidatePath("/accounts");
  return { success: `已建立賬號 ${result.account.loginName}` };
}

export async function resetPasswordAction(
  _prev: ActionMessage,
  formData: FormData,
): Promise<ActionMessage> {
  const ctx = await requireAdminSession();
  if (!ctx) {
    return { error: "沒有權限" };
  }

  const result = await ctx.app.resetPassword(ctx.sessionId, {
    accountId: String(formData.get("accountId") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });

  if (!result.ok) {
    return { error: "重設密碼失敗" };
  }

  revalidatePath("/accounts");
  return { success: "已重設密碼" };
}

export async function setStatusAction(
  _prev: ActionMessage,
  formData: FormData,
): Promise<ActionMessage> {
  const ctx = await requireAdminSession();
  if (!ctx) {
    return { error: "沒有權限" };
  }

  const status = String(formData.get("status") ?? "") as "active" | "suspended";
  const result = await ctx.app.setAccountStatus(ctx.sessionId, {
    accountId: String(formData.get("accountId") ?? ""),
    status,
  });

  if (!result.ok) {
    return { error: "更新狀態失敗" };
  }

  revalidatePath("/accounts");
  return { success: status === "suspended" ? "已暫停賬號" : "已重新啟用賬號" };
}

export async function changeUnitAction(
  _prev: ActionMessage,
  formData: FormData,
): Promise<ActionMessage> {
  const ctx = await requireAdminSession();
  if (!ctx) {
    return { error: "沒有權限" };
  }

  const fixedUnit = String(formData.get("fixedUnit") ?? "") as FixedUnit;
  if (!FIXED_UNITS.includes(fixedUnit)) {
    return { error: "固定單位不正確" };
  }

  const result = await ctx.app.changeFixedUnit(ctx.sessionId, {
    accountId: String(formData.get("accountId") ?? ""),
    fixedUnit,
    reason: String(formData.get("reason") ?? "").trim() || undefined,
  });

  if (!result.ok) {
    return { error: "更改單位失敗" };
  }

  revalidatePath("/accounts");
  return { success: "已更新固定單位" };
}

export async function changeOwnPasswordAction(
  _prev: ActionMessage,
  formData: FormData,
): Promise<ActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return { error: "請重新登入" };
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.changeOwnPassword(sessionId, {
    oldPassword: String(formData.get("oldPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });

  if (!result.ok) {
    return {
      error:
        result.error === "invalid_credentials"
          ? "舊密碼不正確"
          : "請重新登入",
    };
  }

  return { success: "密碼已更新" };
}
