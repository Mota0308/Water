# 店鋪員工系統（靜態前端）

正式產品入口：[`index.html`](./index.html)。

本機可直接開檔，或由上層 `server/`（Express）一併提供前端與 Google Drive API。

部署到 Railway + Drive 請看：[../DEPLOY-RAILWAY-DRIVE.md](../DEPLOY-RAILWAY-DRIVE.md)

舊 Next.js／Mongo 應用在 [`../archive/store-app`](../archive/store-app)。

## 示範賬號

| 角色 | 登入 | 密碼 |
|------|------|------|
| 系統管理員 | admin | admin |
| 一般管理層 | manager | Manager123! |
| 觀塘個人 | kt.staff | Staff123! |
| 屯門個人 | tm.staff | Staff123! |
| 經手人 Ann | ann | 1234 |
| 經手人 Coey | coey | 1234 |
| 經手人 郭sir | kwok | 1234 |
| 國內倉個人 | wh.staff | Staff123! |

有設定 Drive 時：每日／項目資料寫入 Drive 的 `daily.json`／`projects.json`，附件上傳為 Drive 檔案。  
未設定時：退回瀏覽器 `localStorage`＋記憶體種子（示範模式）。
