# 04 — D：項目 CSV 匯出

**What to build:** system_admin 可將開發或補貨模組的項目列表（含關鍵欄位：編號、名稱、分類、狀態、當前階段、進度、期限等）匯出為 CSV 下載。manager／personal 不可匯出。不做 Excel／PDF。

**Blocked by:** 01 建議先完成（狀態欄含暫停／取消才完整）；可接受與 01 平行後補狀態欄。

**Status:** done

- [x] admin 可下載 CSV（依模組類型過濾）
- [x] 含暫停／取消等狀態欄位
- [x] manager／personal 被拒
- [x] 匯出行為有測試或可驗證的 API 覆蓋
