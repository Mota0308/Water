"use server";

import { revalidatePath } from "next/cache";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export async function seedDemoAction(): Promise<void> {
  const sessionId = await readSessionId();
  if (!sessionId) return;
  const app = await getStoreWorkFlowApp();
  await app.seedDemoRecurringTemplates(sessionId);
  revalidatePath("/");
  revalidatePath("/work/recurring");
}
