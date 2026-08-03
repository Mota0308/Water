import Link from "next/link";
import {
  PRODUCT_CATEGORIES,
  currentStageIndex,
  type ProductionProjectType,
  type ProductionProjectView,
  type ProductionTaskView,
} from "@/application/production-domain";
import type { Session } from "@/application/store-work-flow-app";
import {
  moduleBasePath,
  moduleTitle,
  projectTypeForModule,
} from "@/application/production-module-paths";
import type { AppModule } from "@/application/app-module";
import { CreateProjectForm } from "@/components/production/create-project-form";
import { StagePanel } from "@/components/production/stage-panel";
import { AppShell } from "@/components/app-shell";

type ProdModule = Extract<AppModule, "production" | "replenishment">;

function formatDate(value: Date): string {
  return value.toLocaleDateString("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Hong_Kong",
  });
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

export function ProductionHomeView({
  module,
  session,
  summary,
  tasks,
  waitingProjects,
}: {
  module: ProdModule;
  session: Session;
  summary: {
    total: number;
    waitingConfirm: number;
    needFix: number;
    myTaskCount: number;
  };
  tasks: ProductionTaskView[];
  waitingProjects: ProductionProjectView[];
}) {
  const base = moduleBasePath(module);
  const title = moduleTitle(module);
  const isAdmin = session.role === "system_admin";
  const isPersonal = session.role === "personal";

  return (
    <AppShell session={session} module={module} active="prod-home">
      <section className="personal-card">
        <h1 className="personal-card-title">{title}｜首頁</h1>
        <div className="personal-stats">
          <Stat label="項目總數" value={summary.total} />
          <Stat label="待確認" value={summary.waitingConfirm} tone="warn" />
          <Stat label="需要修改" value={summary.needFix} tone="danger" />
          {isPersonal ? (
            <Stat label="我的待辦" value={summary.myTaskCount} tone="ok" />
          ) : null}
        </div>
      </section>

      {isPersonal ? (
        <section className="personal-card">
          <h2 className="personal-card-title">我的待辦</h2>
          {tasks.length === 0 ? (
            <p className="meta">目前沒有待處理階段。</p>
          ) : (
            <ul className="task-list">
              {tasks.map((task) => (
                <li key={`${task.projectId}-${task.stageIndex}`} className="task-item">
                  <Link href={`${base}/projects/${task.projectId}`}>
                    <strong>
                      {task.projectCode} {task.projectName}
                    </strong>
                    <span className="meta">
                      {task.stageName}｜{task.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="meta">
            <Link href={`${base}/my-tasks`}>查看全部我的工作</Link>
          </p>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="personal-card">
          <h2 className="personal-card-title">待確認項目</h2>
          {waitingProjects.length === 0 ? (
            <p className="meta">目前沒有待確認階段。</p>
          ) : (
            <ul className="task-list">
              {waitingProjects.map((project) => {
                const pending = project.stages.find((s) => s.status === "待確認");
                return (
                  <li key={project.id} className="task-item">
                    <Link href={`${base}/projects/${project.id}`}>
                      <strong>
                        {project.code} {project.name}
                      </strong>
                      <span className="meta">
                        {pending?.name ?? "待確認"}｜點擊處理
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {session.role === "manager" ? (
        <section className="personal-card">
          <p className="meta">
            可瀏覽統計與
            <Link href={`${base}/list`}> 項目列表</Link>
            ；建立與確認操作僅限系統管理員。
          </p>
        </section>
      ) : null}
    </AppShell>
  );
}

export function ProductionListView({
  module,
  session,
  projects,
  filters,
}: {
  module: ProdModule;
  session: Session;
  projects: ProductionProjectView[];
  filters: { category: string; status: string; keyword: string };
}) {
  const base = moduleBasePath(module);
  const title = moduleTitle(module);

  return (
    <AppShell session={session} module={module} active="prod-list">
      <section className="personal-card">
        <h1 className="personal-card-title">{title}｜項目列表</h1>
        <form className="form-grid compact" method="get">
          <label>
            分類
            <select name="category" defaultValue={filters.category}>
              <option value="全部">全部</option>
              {PRODUCT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label>
            狀態
            <select name="status" defaultValue={filters.status}>
              <option value="全部">全部</option>
              <option value="待處理">待處理</option>
              <option value="進行中">進行中</option>
              <option value="待確認">待確認</option>
              <option value="需要修改">需要修改</option>
              <option value="已完成">已完成</option>
              <option value="直接下一階段">直接下一階段</option>
              <option value="不適用">不適用</option>
            </select>
          </label>
          <label>
            關鍵字
            <input
              name="keyword"
              defaultValue={filters.keyword}
              placeholder="編號或名稱"
            />
          </label>
          <button type="submit">篩選</button>
        </form>
      </section>

      <section className="personal-card">
        {projects.length === 0 ? (
          <p className="meta">沒有符合條件的項目。</p>
        ) : (
          <div className="records-table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  <th>建立日</th>
                  <th>編號</th>
                  <th>名稱</th>
                  <th>分類</th>
                  <th>當前階段</th>
                  <th>狀態</th>
                  <th>進度</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const cur = project.stages[currentStageIndex(project.stages)];
                  return (
                    <tr key={project.id}>
                      <td>{formatDate(project.createdAt)}</td>
                      <td>
                        <Link href={`${base}/projects/${project.id}`}>
                          {project.code}
                        </Link>
                      </td>
                      <td>
                        <Link href={`${base}/projects/${project.id}`}>
                          {project.name}
                        </Link>
                      </td>
                      <td>{project.category}</td>
                      <td>{project.currentStageName ?? "—"}</td>
                      <td>{cur?.status ?? project.status}</td>
                      <td>{project.progressPercent}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

export function ProductionCreateView({
  module,
  session,
  handlers,
}: {
  module: ProdModule;
  session: Session;
  handlers: {
    accountId: string;
    displayName: string;
    department: string | null;
  }[];
}) {
  const type = projectTypeForModule(module);
  const title = moduleTitle(module);

  return (
    <AppShell session={session} module={module} active="prod-create">
      <section className="personal-card">
        <h1 className="personal-card-title">建立{title}項目</h1>
        <p className="meta">
          {type === "dev" ? "固定 7 個開發階段" : "固定 6 個補貨階段"}
          ；經手人來自啟用中的個人賬號。
        </p>
        <CreateProjectForm type={type} handlers={handlers} />
      </section>
    </AppShell>
  );
}

export function ProductionMyTasksView({
  module,
  session,
  tasks,
}: {
  module: ProdModule;
  session: Session;
  tasks: ProductionTaskView[];
}) {
  const base = moduleBasePath(module);
  const title = moduleTitle(module);

  return (
    <AppShell session={session} module={module} active="prod-tasks">
      <section className="personal-card">
        <h1 className="personal-card-title">{title}｜我的工作</h1>
        {session.role !== "personal" ? (
          <p className="meta">此頁面顯示個人賬號的待辦階段。</p>
        ) : tasks.length === 0 ? (
          <p className="meta">目前沒有待處理工作。</p>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={`${task.projectId}-${task.stageIndex}`} className="task-item">
                <Link href={`${base}/projects/${task.projectId}`}>
                  <strong>
                    {task.projectCode} {task.projectName}
                  </strong>
                  <span className="meta">
                    {task.stageName}｜{task.status}
                    {task.deadline ? `｜期限 ${task.deadline}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

export function ProductionDetailView({
  module,
  session,
  project,
  handlers,
}: {
  module: ProdModule;
  session: Session;
  project: ProductionProjectView;
  handlers: {
    accountId: string;
    displayName: string;
    department: string | null;
  }[];
}) {
  const title = moduleTitle(module);
  const isAdmin = session.role === "system_admin";
  const current = currentStageIndex(project.stages);

  return (
    <AppShell session={session} module={module} active="prod-detail">
      <section className="personal-card">
        <h1 className="personal-card-title">
          {project.code}｜{project.name}
        </h1>
        <p className="meta">
          {title}｜{project.category}
          {project.dueDate ? `｜期限 ${project.dueDate}` : ""}
          ｜進度 {project.progressPercent}%
        </p>
        {project.description ? <p>{project.description}</p> : null}
        <div className="personal-progress">
          <div className="personal-progress-track">
            <div
              className="personal-progress-bar"
              style={{ width: `${project.progressPercent}%` }}
            />
          </div>
          <span>{project.progressPercent}%</span>
        </div>
      </section>

      <section className="personal-card">
        <h2 className="personal-card-title">階段流程</h2>
        <ul className="prod-stage-list">
          {project.stages.map((stage) => {
            const isCurrent = stage.index === current;
            const canUpdate =
              session.role === "personal" &&
              isCurrent &&
              stage.handlerAccountId === session.accountId &&
              (stage.status === "待處理" ||
                stage.status === "進行中" ||
                stage.status === "需要修改");
            return (
              <StagePanel
                key={stage.index}
                projectId={project.id}
                type={project.type}
                stage={stage}
                isCurrent={isCurrent}
                canUpdate={canUpdate}
                isAdmin={isAdmin}
                handlers={handlers}
              />
            );
          })}
        </ul>
      </section>
    </AppShell>
  );
}

export type { ProdModule, ProductionProjectType };
