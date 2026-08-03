import Link from "next/link";
import type { AppModule } from "@/application/app-module";
import type { Session } from "@/application/store-work-flow-app";
import { logoutAction } from "@/app/actions/auth";
import { ModuleSidebar } from "@/components/module-shell";

export type AppTab =
  | "today"
  | "progress"
  | "records"
  | "new"
  | "recurring"
  | "history"
  | "accounts"
  | "password"
  | "settings"
  | "detail"
  | "prod-home"
  | "prod-list"
  | "prod-create"
  | "prod-tasks"
  | "prod-detail";

function roleLabel(role: Session["role"]): string {
  switch (role) {
    case "system_admin":
      return "系統管理員";
    case "manager":
      return "一般管理層";
    default:
      return "個人賬號";
  }
}

function dailyTabs(session: Session) {
  const isPersonal = session.role === "personal";
  if (isPersonal) {
    return [
      { href: "/", id: "today" as const, label: "今日工作" },
      { href: "/progress", id: "progress" as const, label: "各單位進度" },
      { href: "/my-records", id: "records" as const, label: "我的完成記錄" },
      { href: "/settings", id: "settings" as const, label: "個人設置" },
    ];
  }
  return [
    { href: "/", id: "today" as const, label: "今日工作" },
    { href: "/progress", id: "progress" as const, label: "各單位進度" },
    { href: "/work/new", id: "new" as const, label: "新增突發" },
    { href: "/work/recurring", id: "recurring" as const, label: "恆常模板" },
    { href: "/history", id: "history" as const, label: "歷史統計" },
    ...(session.role === "system_admin"
      ? [{ href: "/accounts", id: "accounts" as const, label: "賬號管理" }]
      : []),
  ];
}

function productionTabs(
  module: "production" | "replenishment",
  session: Session,
) {
  const base = module === "production" ? "/production" : "/replenishment";
  const tabs: { href: string; id: AppTab; label: string }[] = [
    { href: base, id: "prod-home", label: "首頁" },
    { href: `${base}/list`, id: "prod-list", label: "項目列表" },
    { href: `${base}/my-tasks`, id: "prod-tasks", label: "我的工作" },
  ];
  if (session.role === "system_admin") {
    tabs.push({
      href: `${base}/new`,
      id: "prod-create",
      label: "建立項目",
    });
  }
  return tabs;
}

export function AppShell({
  session,
  active,
  module = "daily",
  children,
}: {
  session: Session;
  active: AppTab;
  module?: AppModule;
  children: React.ReactNode;
}) {
  const isPersonal = session.role === "personal";
  const tabs =
    module === "daily"
      ? dailyTabs(session)
      : productionTabs(module, session);

  const brand =
    module === "daily"
      ? "每日工作流程管理系統"
      : module === "production"
        ? "開發及生產管理"
        : "補貨管理";

  return (
    <div className="personal-app app-with-modules">
      <ModuleSidebar active={module} />
      <div className="app-module-main">
        <header className="personal-topbar">
          <div className="personal-brand">
            <span className="personal-brand-icon" aria-hidden>
              ▦
            </span>
            <span>{brand}</span>
          </div>
          <div className="personal-user">
            <span>
              {session.displayName}
              {isPersonal && session.fixedUnit
                ? ` | 所屬單位：${session.fixedUnit}`
                : ` | ${roleLabel(session.role)}`}
            </span>
            {isPersonal ? (
              <Link href="/settings" className="personal-link">
                個人設置
              </Link>
            ) : null}
            <Link href="/password" className="personal-link">
              修改密碼
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="personal-logout">
                登出
              </button>
            </form>
          </div>
        </header>

        <nav className="personal-tabs" aria-label="主要功能">
          {tabs.map((tab) => (
            <TabLink
              key={tab.href}
              href={tab.href}
              active={
                active === tab.id ||
                (active === "detail" && tab.id === "today") ||
                (active === "prod-detail" && tab.id === "prod-list")
              }
            >
              {tab.label}
            </TabLink>
          ))}
        </nav>

        <div className="personal-main">{children}</div>
      </div>
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={active ? "personal-tab is-active" : "personal-tab"}
    >
      {children}
    </Link>
  );
}
