import type { AppModule } from "./app-module";
import type { ProductionProjectType } from "./production-domain";

export function projectTypeForModule(
  module: Extract<AppModule, "production" | "replenishment">,
): ProductionProjectType {
  return module === "production" ? "dev" : "rep";
}

export function moduleBasePath(
  module: Extract<AppModule, "production" | "replenishment">,
): string {
  return module === "production" ? "/production" : "/replenishment";
}

export function moduleTitle(
  module: Extract<AppModule, "production" | "replenishment">,
): string {
  return module === "production" ? "開發及生產" : "補貨";
}
