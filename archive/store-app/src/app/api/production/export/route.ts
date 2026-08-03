import { NextResponse } from "next/server";
import type { ProductionProjectType } from "@/application/production-domain";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const type = new URL(request.url).searchParams.get("type") as
    | ProductionProjectType
    | null;
  if (type !== "dev" && type !== "rep") {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const app = await getStoreWorkFlowApp();
  const result = await app.exportProductionProjectsCsv(sessionId, { type });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }
  const filename = type === "dev" ? "production-projects.csv" : "replenishment-projects.csv";
  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
