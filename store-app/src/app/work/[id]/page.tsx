import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ManagerEditWorkForm,
  ManagerWorkActions,
} from "@/app/work/manager-work-actions";
import { AppShell } from "@/components/app-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");

  const detail = await app.getWork(auth.session.sessionId, { workId: id });
  if (!detail.ok) {
    redirect("/");
  }

  const listed = await app.listWorkAttachments(auth.session.sessionId, {
    workId: id,
  });
  if (!listed.ok) {
    redirect("/");
  }

  const isManager =
    auth.session.role === "manager" || auth.session.role === "system_admin";

  const history = isManager
    ? await app.listCompletionHistory(auth.session.sessionId, { workId: id })
    : null;

  return (
    <AppShell session={auth.session} active="detail">
      <div className="personal-detail-head">
        <h1 className="personal-card-title" style={{ margin: 0 }}>
          工作詳情
        </h1>
        <Link href="/" className="text-btn">
          返回今日工作
        </Link>
      </div>

      <section className="personal-card stack">
        <h2 className="personal-card-title">{detail.work.title}</h2>
        <p>{detail.work.content}</p>
        <p className="meta">
          {detail.work.unit} · {detail.work.status} · {detail.work.priority}
        </p>
        {detail.work.completionNote ? (
          <p className="meta">完成備註：{detail.work.completionNote}</p>
        ) : null}
        {isManager ? (
          <ManagerWorkActions
            workId={detail.work.id}
            status={detail.work.status}
            type={detail.work.type}
          />
        ) : null}
      </section>

      {isManager && detail.work.status !== "cancelled" ? (
        <section className="personal-card">
          <h2 className="personal-card-title">編輯工作</h2>
          <ManagerEditWorkForm
            workId={detail.work.id}
            title={detail.work.title}
            content={detail.work.content}
            priority={detail.work.priority}
          />
        </section>
      ) : null}

      <section className="personal-card stack">
        <h2 className="personal-card-title">
          附件（{listed.attachments.length}）
        </h2>
        {listed.attachments.length === 0 ? (
          <p className="meta">尚無附件</p>
        ) : (
          <ul className="attachment-list">
            {listed.attachments.map((file) => (
              <li key={file.id}>
                <a
                  href={`data:${file.contentType};base64,${file.dataBase64}`}
                  download={file.fileName}
                >
                  {file.fileName}
                </a>
                <span className="meta">
                  {" "}
                  · {file.uploadedByDisplayName} ·{" "}
                  {file.uploadedAt.toLocaleString("zh-HK")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history?.ok ? (
        <section className="personal-card stack">
          <h2 className="personal-card-title">
            歷史完成紀錄（{history.history.length}）
          </h2>
          {history.history.length === 0 ? (
            <p className="meta">尚無因重新開啟而封存的完成紀錄</p>
          ) : (
            <ul>
              {history.history.map((row) => (
                <li key={row.id}>
                  {row.completedByDisplayName ?? "未知"} 於{" "}
                  {row.completedAt
                    ? row.completedAt.toLocaleString("zh-HK")
                    : "—"}{" "}
                  完成
                  {row.completionNote ? ` · 備註：${row.completionNote}` : ""}
                  <br />
                  <span className="meta">
                    由 {row.reopenedByDisplayName} 重新開啟（{row.reason}）·{" "}
                    {row.reopenedAt.toLocaleString("zh-HK")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </AppShell>
  );
}
