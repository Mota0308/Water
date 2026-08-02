# 門市工作流程系統（store-app）

第一部分內部工具：Next.js + TypeScript + MongoDB + 自建帳密。  
業務邏輯集中在 `src/application/store-work-flow-app.ts`（門市工作流程應用服務）。

## 本機（MongoDB Compass）

1. 用 Compass / 本機 `mongod` 建立資料庫（預設名稱 `store-work-flow`）。
2. 複製環境變數：

```bash
cp .env.example .env.local
```

3. 確認 `.env.local` 的 `MONGODB_URI`，例如：

```env
MONGODB_URI=mongodb://127.0.0.1:27017/store-work-flow
```

4. 安裝與種子系統管理員：

```bash
npm install
npm run seed
npm run dev
```

預設管理員：`admin` / `ChangeMe123!`（可用環境變數覆寫）。

## Railway

1. 在 Railway 建立 MongoDB（或使用 Atlas），取得連線字串。
2. 部署此 Next.js 服務，設定環境變數：
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`（可選）
   - `SEED_ADMIN_LOGIN` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME`（首次種子用）
3. 部署後執行一次種子（Railway one-off / release command）：

```bash
npm run seed
```

## 測試

```bash
npm test
npm run typecheck
```

測試使用 `mongodb-memory-server`，不必啟動本機 MongoDB。
