import { describe, expect, it } from "vitest";
import { moduleHomePath, resolveAppModule } from "./app-module";

describe("resolveAppModule", () => {
  it("將 /production 與子路徑判為開發及生產模組", () => {
    expect(resolveAppModule("/production")).toBe("production");
    expect(resolveAppModule("/production/projects/1")).toBe("production");
  });

  it("將 /replenishment 與子路徑判為補貨模組", () => {
    expect(resolveAppModule("/replenishment")).toBe("replenishment");
    expect(resolveAppModule("/replenishment/new")).toBe("replenishment");
  });

  it("其餘受保護路徑屬每日工作流程", () => {
    expect(resolveAppModule("/")).toBe("daily");
    expect(resolveAppModule("/progress")).toBe("daily");
    expect(resolveAppModule("/history")).toBe("daily");
    expect(resolveAppModule("/work/new")).toBe("daily");
  });
});

describe("moduleHomePath", () => {
  it("回傳各模組首頁路徑", () => {
    expect(moduleHomePath("daily")).toBe("/");
    expect(moduleHomePath("production")).toBe("/production");
    expect(moduleHomePath("replenishment")).toBe("/replenishment");
  });
});
