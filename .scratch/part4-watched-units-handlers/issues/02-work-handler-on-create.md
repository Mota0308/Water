# 02 — 突發／恆常：地區＋可選負責人

**What to build:** 建立突發工作與恆常模板時，先選一或多個地區，再為每一地區選（可選）負責人。負責人候選為該地區 `fixedUnit`、啟用中的 personal。系統仍為每地區各產生一筆工作實例，並寫入 `handlerAccountId`（可 null）。每日結算類型不提供／不寫入個人負責人。`system_admin` 與 `manager` 可建立。

**Blocked by:** None（可與 01 平行；UI 候選人列表可先做 API）

**Status:** done

- [x] 突發建立支援每單位可選負責人；持久化並在 WorkView 露出
- [x] 恆常模板支援每單位可選負責人；生成實例時帶入
- [x] 每日結算不設個人負責人
- [x] 負責人候選僅該單位 active personal；非法人選被拒
- [x] manager／admin 可建；personal 不可建（沿用）
- [x] Application API 有測試覆蓋
