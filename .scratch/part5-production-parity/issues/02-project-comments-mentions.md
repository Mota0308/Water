# 02 — B：項目留言、回覆與 @提及

**What to build:** 項目詳情有留言板：可發表留言、回覆；內容中 `@顯示名稱` 高亮。personal／manager／admin 皆可讀寫留言（admin 可軟刪移除）。提供「被提及」彙總（模組首頁或我的工作），點進對應項目。留言不代表階段完成。不做推播／電郵。

**Blocked by:** None（可與 01 平行；建議 01 後合併驗收較穩）

**Status:** done

- [x] 項目可留言與回覆並持久化
- [x] @提及高亮；被提及者可在彙總列表看到
- [x] system_admin 可軟刪留言；他人不可
- [x] manager 可留言但不可管理移除（若決策需調整以 decisions 為準：manager 唯讀管理操作—留言發表可允許）
- [x] API／權限有測試覆蓋

**權限釐清（依 decisions）：** manager 對「管理操作」唯讀；發表留言屬協作可允許。移除留言僅 system_admin。
