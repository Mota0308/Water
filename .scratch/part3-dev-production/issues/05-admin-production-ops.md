# 05 — 系統管理員生產管理操作

**What to build:** system_admin 在項目中可：變更階段經手人、處理「待確認」（確認通過或退回需修改）、並在需要時代為推進階段（對齊示範 admin 能力的 MVP 子集）。manager 仍不可執行這些管理操作。

**Blocked by:** 04 — 項目詳情與經手人階段推進

**Status:** done

- [x] system_admin 可更改任一階段經手人（active personal）
- [x] system_admin 可確認或退回「待確認」階段
- [x] system_admin 可代操作階段（至少覆蓋示範中 admin 常用路徑）
- [x] manager／personal 呼叫上述管理 API 被拒絕
- [x] 管理操作有測試覆蓋
