# 店鋪員工系統（靜態示範）

正式產品入口：在瀏覽器開啟 [`index.html`](./index.html)。

舊 Next.js／Mongo 應用已移至 [`../archive/store-app`](../archive/store-app) 作唯讀參考。

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

每日工作資料存在瀏覽器 `localStorage`（鍵：`store-web-daily-v2`；會清除舊 v1）。生產／補貨示範為記憶體種子，重整會重置。

每日模組已對齊計劃書 Part 1 主路徑：剔選完成、逾期、跨單位唯讀明細、突發／恆常編輯停用取消、門市結算（國內倉無結算）、我的記錄。
