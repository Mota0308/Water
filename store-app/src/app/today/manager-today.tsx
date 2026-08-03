import Link from "next/link";
import {
  FIXED_UNITS,
  type Session,
  type TodayWorkSummary,
  type WorkView,
} from "@/application/store-work-flow-app";
import { ManagerWorkActions } from "@/app/work/manager-work-actions";
import { AppShell } from "@/components/app-shell";

export function ManagerTodayView({
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

  const byUnit = FIXED_UNITS.map((unit) => ({
    unit,
    works: works.filter((work) => work.unit === unit),
  })).filter((group) => group.works.length > 0);

  return (
    <AppShell session={session} active="today">
      <section className="personal-card">
        <h1 className="personal-card-title">{dateLabel} | 全店今日工作</h1>
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

      {byUnit.length === 0 ? (
        <section className="personal-card">
          <p className="meta">目前沒有工作項目。可新增突發或恆常模板。</p>
        </section>
      ) : (
        byUnit.map((group) => (
          <section key={group.unit} className="personal-card">
            <h2 className="personal-card-title unit-group-title">
              {group.unit}
              <span className="meta">（{group.works.length}）</span>
            </h2>
            <ul className="task-list">
              {group.works.map((work) => {
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
                      {work.status === "completed" ? (
                        <span className="task-done" aria-label="已完成" />
                      ) : work.type === "daily_settlement" ? (
                        <span className="task-lock" aria-label="鎖定" />
                      ) : (
                        <span className="task-pending-dot" aria-hidden />
                      )}
                    </div>
                    <div className="task-body">
                      <div className="task-title-row">
                        <Link href={`/work/${work.id}`} className="task-title">
                          {work.title}
                        </Link>
                        <span className={`pill type-${work.type}`}>
                          {typeLabel}
                        </span>
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
                        {work.status === "completed" ? (
                          <span className="pill status-ontime">
                            {work.completedByDisplayName}
                          </span>
                        ) : null}
                      </div>
                      <ManagerWorkActions
                        workId={work.id}
                        status={work.status}
                        type={work.type}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </AppShell>
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
