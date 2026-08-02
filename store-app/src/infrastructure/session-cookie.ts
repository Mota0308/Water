import { cookies } from "next/headers";

export const SESSION_COOKIE = "swf_session";

export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionId(sessionId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function clearSessionId(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
