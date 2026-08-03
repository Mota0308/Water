# 03 — 負責人完成權與同區唯讀

**What to build:** 當工作有 `handlerAccountId` 時：僅該負責人可 `completeWork`；同區其他 personal 在今日列表看得到但不可完成（UI 唯讀＋API 拒絕）。無負責人時：`fixedUnit`＝該單位的 personal 可完成（現況）。manager／admin 維持管理視圖與既有管理操作。列表／詳情應顯示負責人姓名（若有）。

**Blocked by:** 02 — 突發／恆常：地區＋可選負責人

**Status:** done

- [x] 有負責人時非負責人 personal 完成被拒
- [x] 負責人可完成；無負責人時同區 personal 可完成
- [x] 同區非負責人可見任務但 UI 不提供完成操作
- [x] manager／admin 行為不因負責人欄位而失去管理能力
- [x] 權限與完成路徑有測試覆蓋
