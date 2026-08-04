# 店鋪員工系統（靜態前端）

正式產品入口：[`index.html`](./index.html)。

本機可直接開檔，或由上層 `server/`（Express）一併提供前端與 MongoDB API。

部署到 Railway + MongoDB Atlas（Compass 可查看）請看：[../DEPLOY-MONGODB.md](../DEPLOY-MONGODB.md)

舊 Next.js 應用在 [`../archive/store-app`](../archive/store-app)（歸檔，非正式入口）。

## 預設賬號

| 角色 | 登入 | 密碼 |
|------|------|------|
| 系統管理員 | admin | admin |

其他員工請由管理員在「創建員工」新增；初始密碼為賬號最後四位。

有設定 `MONGODB_URI` 時：每日／項目寫入 MongoDB，附件存 GridFS。  
未設定時：本機模式（瀏覽器 `localStorage`）。
