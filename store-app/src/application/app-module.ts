export type AppModule = "daily" | "production" | "replenishment";

export function resolveAppModule(pathname: string): AppModule {
  if (pathname === "/production" || pathname.startsWith("/production/")) {
    return "production";
  }
  if (
    pathname === "/replenishment" ||
    pathname.startsWith("/replenishment/")
  ) {
    return "replenishment";
  }
  return "daily";
}

export function moduleHomePath(module: AppModule): string {
  switch (module) {
    case "production":
      return "/production";
    case "replenishment":
      return "/replenishment";
    default:
      return "/";
  }
}
