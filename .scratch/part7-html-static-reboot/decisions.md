# Part 7 — HTML 靜態重啟（決策摘要）

來源：grilling（2026-08-03）— 使用者已確認

## 目標

- 不再以 Next.js／Mongo 當正式產品；另起靜態專案
- 原樣複製 `開發及生產部.html` 為正本（含 emoji、示範互動）
- 再重塑 Part 1 主路徑進同一殼

## 架構

- 單檔 `index.html`（CSS／JS 內嵌）
- 資料：每日工作 → localStorage；生產／補貨示範 → 記憶體＋種子
- 後端以後再接

## 舊碼

- `store-app` 整包移至 `archive/store-app`（唯讀參考）

## 導覽

- 兩層：每日工作流程｜開發及生產｜補貨 → 模組內子導覽

## 角色

- `system_admin`／`manager`／`personal`（個人綁固定單位）
- 生產權限對齊舊站：manager 監督只讀；personal 經手；admin 全權

## Part 1 深度（第一波）

- 今日工作、突發／恆常、跨單位進度、結算概念
- 不做全量：附件規則、歷史匯出、賬號治理等留後續

## 明確不做（本波）

- 繼續在 Next 裡「再對齊一次外觀」
- 第一波就接真後端／DB
