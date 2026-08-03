import Link from "next/link";
import type { AppModule } from "@/application/app-module";
import { moduleHomePath } from "@/application/app-module";

const MODULES: { id: AppModule; label: string }[] = [
  { id: "daily", label: "每日工作流程" },
  { id: "production", label: "開發及生產" },
  { id: "replenishment", label: "補貨" },
];

/** @deprecated Use ModuleTopNav — kept for any stray imports */
export function ModuleSidebar({ active }: { active: AppModule }) {
  return <ModuleTopNav active={active} />;
}

export function ModuleTopNav({ active }: { active: AppModule }) {
  return (
    <nav className="module-top-nav" aria-label="系統模組">
      {MODULES.map((mod) => (
        <Link
          key={mod.id}
          href={moduleHomePath(mod.id)}
          className={
            active === mod.id ? "module-top-item is-active" : "module-top-item"
          }
        >
          {mod.label}
        </Link>
      ))}
    </nav>
  );
}
