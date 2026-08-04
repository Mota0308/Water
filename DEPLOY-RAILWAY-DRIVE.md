# Railway 前端＋後端 + Google Drive 資料儲存

架構：瀏覽器 → Railway（Express 提供 `store-web` + `/api/*`）→ Google Drive 資料夾。

Drive 會出現：

- `daily.json` — 每日工作流程
- `projects.json` — 開發／補貨項目、序號、操作記錄、用戶
- 其餘上傳的附件／封面檔案

資料夾 ID（你提供的分享連結）：`11fjBkD7bdqpEqddtBxyJDzdD-RrCwESS`

## 1. Google Cloud（你已建立專案）

1. 啟用 **Google Drive API**
2. **IAM 與管理 → 服務帳戶** → 建立服務帳戶 → 建立金鑰（JSON）並下載
3. 打開金鑰裡的 `client_email`（形如 `xxx@....iam.gserviceaccount.com`）
4. 在 Google Drive 把該資料夾分享給這個 email，權限選 **編輯者**
5. **不要**把 JSON 金鑰提交到 git，也**不要**貼到聊天

## 2. 本機測試

```bash
copy server\.env.example .env
# 編輯根目錄 .env：貼上 GOOGLE_SERVICE_ACCOUNT_JSON（整段一行）與 FOLDER_ID
npm install
npm start
```

（可用 `dotenv` 或在啟動前手動 `set` 環境變數。Railway 則在 Variables 設定，不必放 `.env` 檔。）

瀏覽器開 `http://localhost:8080/`  
登入頁應顯示「已連接 Google Drive 資料儲存」。

健康檢查：`http://localhost:8080/api/health`

## 3. Railway 部署

1. 將本 repo 推到 GitHub（確認 `.gitignore` 排除 `.env` 與金鑰）
2. [Railway](https://railway.app) → New Project → Deploy from GitHub
3. 用帳號 `chenyaolin0308@gmail.com` 登入 Railway（若該帳號已註冊）
4. 服務 Variables 新增：

| 變數 | 值 |
|------|-----|
| `GOOGLE_DRIVE_FOLDER_ID` | `11fjBkD7bdqpEqddtBxyJDzdD-RrCwESS` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 服務帳戶 JSON **整段一行**（Railway UI 不要再加外層引號） |
| `PORT` | 可省略（Railway 會注入） |

5. Build / Start 使用 repo 根目錄：`npm install` + `npm start`（`node server/index.js`）
6. Generate Domain 後用該網址開啟

## 4. 注意

- Drive 當 JSON 倉庫適合示範／小團隊；多人同時狂按可能互相覆蓋
- 附件走 Drive 檔案 ID，前端透過 `/api/files/:id` 下載
- 未設定環境變數時會退回本機示範（localStorage／記憶體種子）
