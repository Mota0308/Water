import Link from "next/link";
import type {
  Session,
  TodayWorkSummary,
  WorkView,
} from "@/application/store-work-flow-app";
import { cancelCompletionAction } from "@/app/actions/work";
import { CompleteWorkForm } from "@/app/work/complete-work-form";
import { PersonalShell } from "@/components/personal-shell";

export function PersonalTodayView({
  session,
  works,
  summary,
}: {
  session: Session;
  works: WorkView[];
  summary: TodayWorkSummary;
}) {
  const now = Date.now();
  const dateLabel = new Date().toLocaleDateString("zh-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Hong_Kong",
  });

  return (
    <PersonalShell session={session} active="today">
      <section className="personal-card">
        <h1 className="personal-card-title">
          {dateLabel} | {session.fixedUnit ?? ""} 今日工作
        </h1>
        <div className="personal-stats">
          <Stat label="工作總數" value={summary.total} />
          <Stat label="已完成" value={summary.completed} tone="ok" />
          <Stat label="未完成" value={summary.pending} tone="warn" />
          <Stat label="已逾期" value={summary.overdue} tone="danger" />
        </div>
        <div className="personal-progress">
          <div className="personal-progress-track">
            <div
              className="personal-progress-bar"
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          <span>{summary.percent}%</span>
        </div>
      </section>

      <section className="personal-card">
        <h2 className="personal-card-title">工作清單（按優先次序排列）</h2>
        {works.length === 0 ? (
          <p className="meta">目前沒有工作項目。</p>
        ) : (
          <ul className="task-list">
            {works.map((work) => {
              const overdue =
                work.status === "pending" &&
                !!work.dueAt &&
                work.dueAt.getTime() < now;
              const notStarted = work.status === "pending" && !overdue;
              const typeLabel =
                work.type === "adhoc"
                  ? "突發"
                  : work.type === "recurring"
                    ? "恆常"
                    : "每日結算";

              return (
                <li
                  key={work.id}
                  className={`task-row status-${work.status}${overdue ? " is-overdue" : ""}`}
                >
                  <div className="task-leading">
                    {work.type === "daily_settlement" ? (
                      <span
                        className="task-lock"
                        title="不可手動剔選"
                        aria-label="鎖定"
                      />
                    ) : work.status === "completed" ? (
                      <span className="task-done" aria-label="已完成" />
                    ) : (
                      <CompleteWorkForm
                        workId={work.id}
                        attachmentRequirement={work.attachmentRequirement}
                        noteRequirement={work.noteRequirement}
                        variant="checkbox"
                      />
                    )}
                  </div>

                  <div className="task-body">
                    <div className="task-title-row">
                      <Link href={`/work/${work.id}`} className="task-title">
                        {work.title}
                      </Link>
                      <span className={`pill type-${work.type}`}>{typeLabel}</span>
                      <span className={`pill priority-${work.priority}`}>
                        {priorityLabel(work.priority)}
                      </span>
                      {work.dueAt ? (
                        <span className="pill due">
                          期限{" "}
                          {work.dueAt.toLocaleTimeString("zh-HK", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                            timeZone: "Asia/Hong_Kong",
                          })}
                        </span>
                      ) : null}
                      {overdue ? (
                        <span className="pill status-overdue">已逾期</span>
                      ) : null}
                      {notStarted ? (
                        <span className="pill status-open">未開始</span>
                      ) : null}
                    </div>

                    {work.type === "daily_settlement" ? (
                      <p className="task-note">
                        此工作由第二部分（POS 匯入與日結）自動更新，不可手動剔選。
                      </p>
                    ) : null}

                    {work.status === "completed" ? (
                      <div className="task-completed-meta">
                        <span>
                          {work.completedAt
                            ? work.completedAt.toLocaleTimeString("zh-HK", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                                timeZone: "Asia/Hong_Kong",
                              })
                            : ""}{" "}
                          · {work.completedByDisplayName}
                        </span>
                        {work.completedByAccountId === session.accountId ? (
                          <form action={cancelCompletionAction}>
                            <input type="hidden" name="workId" value={work.id} />
                            <button type="submit" className="text-btn">
                              取消剔選
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PersonalShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className={`personal-stat${tone ? ` tone-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case "urgent":
      return "緊急";
    case "important":
      return "重要";
    default:
      return "一般";
  }
}
