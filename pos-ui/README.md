# POS UI（React）

嵌入員工網站側欄的 React POS 介面（參考 `app_17c3n3qkmqq` 三欄收銀）。

- 建置：`npm run build:pos-ui`（根目錄）或 `npm run build`（本目錄）
- 輸出：`store-web/pos-ui/`
- 以 iframe 載入：`/pos-ui/index.html#/pos` 等 Hash 路由
- 鉴權：讀取與員工站相同的 `localStorage` key `store-web-auth-token-v1`
- API：現有 `/api/pos/*`
