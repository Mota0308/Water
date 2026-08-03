import { NextResponse } from "next/server";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await context.params;
  const app = await getStoreWorkFlowApp();
  const result = await app.getProductionFileContent(sessionId, { fileId: id });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  const bytes = Buffer.from(result.dataBase64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    },
  });
}
