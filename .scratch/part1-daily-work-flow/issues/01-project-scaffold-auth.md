# 01 — 專案骨架與登入登出

**What to build:** 從空專案建立可運行的內部 Web 應用基礎：Next.js + TypeScript + MongoDB + 自建帳密，並露出「門市工作流程應用服務」作為唯一業務 seam。種子建立一名系統管理員後，使用者可以登入、登出；未登入無法進入受保護頁面。資料庫以 MongoDB 連線字串配置（本機可用 Compass；部署可用 Railway MongoDB／連線 URI）。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 專案可在本機以 MongoDB 啟動，並完成資料庫連線
- [x] Application API seam 已存在且為後續業務的唯一入口
- [x] 可種子建立一名有效系統管理員賬號
- [x] 系統管理員可用自訂登入名稱與密碼登入
- [x] 登出後無法繼續存取受保護頁面
- [x] 未登入存取受保護路由會被拒絕或導向登入
- [x] 針對登入／登出／未授權存取的 Application API 行為有測試覆蓋

## Comments

- 2026-08-02：資料庫由 PostgreSQL 改為 MongoDB（Compass／Railway URI）。實作於 `store-app/`。
