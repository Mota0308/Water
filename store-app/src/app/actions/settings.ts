"use server";

import { revalidatePath } from "next/cache";
import {
  FIXED_UNITS,
  type FixedUnit,
} from "@/application/store-work-flow-app";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export type SettingsActionMessage = { error?: string; success?: string };

export async function updateWatchedUnitsAction(
  _prev: SettingsActionMessage,
  formData: FormData,
): Promise<SettingsActionMessage> {
  const sessionId = await readSessionId();
  if (!sessionId) return { error: "請重新登入" };

  const units = formData
    .getAll("watchedUnits")
    .map(String)
    .filter((unit): unit is FixedUnit =>
      (FIXED_UNITS as readonly string[]).includes(unit),
    );

  const app = await getStoreWorkFlowApp();
  const result = await app.updateWatchedUnits(sessionId, { units });
  if (!result.ok) {
    if (result.error === "units_required") {
      return { error: "請至少選擇一個關注地區" };
    }
    if (result.error === "forbidden") {
      return { error: "僅個人賬號可設定關注地區" };
    }
    return { error: "儲存失敗" };
  }

  revalidatePath("/");
  revalidatePath("/settings");
  return { success: "關注地區已更新" };
}
