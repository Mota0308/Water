# 01 — 個人設置：關注地區

**What to build:** personal 可在獨立「個人設置」頁多選關注地區（`FIXED_UNITS`）。至少選 1 個；預設／缺省＝自己的 `fixedUnit`。設定持久化至賬號。今日工作列表僅顯示關注地區內的任務（可見性篩選）；完成權仍依所屬單位／負責人規則，關注不擴大完成權。導覽頂欄提供進入入口（與修改密碼分開）。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] personal 有獨立個人設置頁，可多選關注地區
- [x] 至少須選 1 個；儲存後可讀回
- [x] 未設定時行為等同只關注 `fixedUnit`
- [x] 今日工作僅列出關注地區內項目；跨關注非所屬單位任務為唯讀（若可見）
- [x] Application API 有測試覆蓋
