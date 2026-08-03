import Link from "next/link";
import type { AppModule } from "@/application/app-module";
import { moduleHomePath } from "@/application/app-module";

const MODULES: { id: AppModule; label: string }[] = [
  { id: "daily", label: "每日工作流程" },
  { id: "production", label: "開發及生產" },
  { id: "replenishment", label: "補貨" },
];

export function ModuleSidebar({ active }: { active: AppModule }) {
  return (
    <aside className="module-sidebar" aria-label="系統模組">
      <div className="module-sidebar-brand">模組</div>
      <nav className="module-sidebar-nav">
        {MODULES.map((mod) => (
          <Link
            key={mod.id}
            href={moduleHomePath(mod.id)}
            className={
              active === mod.id ? "module-nav-item is-active" : "module-nav-item"
            }
          >
            {mod.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
