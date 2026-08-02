"use server";

import { redirect } from "next/navigation";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import {
  clearSessionId,
  readSessionId,
  writeSessionId,
} from "@/infrastructure/session-cookie";

export type LoginFormState = {
  error?: string;
};

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const loginName = String(formData.get("loginName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!loginName || !password) {
    return { error: "請輸入登入名稱及密碼" };
  }

  const app = await getStoreWorkFlowApp();
  const result = await app.login({ loginName, password });

  if (!result.ok) {
    return { error: "登入名稱或密碼不正確" };
  }

  await writeSessionId(result.sessionId);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const sessionId = await readSessionId();
  if (sessionId) {
    const app = await getStoreWorkFlowApp();
    await app.logout(sessionId);
  }
  await clearSessionId();
  redirect("/login");
}
