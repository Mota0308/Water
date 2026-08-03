# 01 — A：項目編輯／暫停／取消

**What to build:** system_admin 可編輯開發／補貨項目基本資料（編號、名稱、分類、說明、整體期限等），並可將項目暫停或取消（需原因，寫入更新時間／操作者）。暫停／取消後階段推進應被阻擋；manager／personal 不可執行這些管理操作。列表與詳情清楚顯示暫停／取消狀態。不做封存。

**Blocked by:** None — can start immediately（建基於 Part 3 API）

**Status:** done

- [x] system_admin 可編輯項目基本欄位並持久化
- [x] system_admin 可暫停／取消項目（需原因）
- [x] 暫停／取消後經手人無法再推進階段
- [x] manager／personal 呼叫管理 API 被拒
- [x] 列表／詳情顯示狀態；API 有測試覆蓋
