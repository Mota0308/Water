"use client";

import type {
  StaffStatView,
  WorkView,
} from "@/application/store-work-flow-app";

export function HistoryPanel({
  units,
  selectedUnit,
  selectedStatus,
  works,
  stats,
  csv,
}: {
  units: string[];
  selectedUnit: string;
  selectedStatus: string;
  works: WorkView[];
  stats: StaffStatView[];
  csv: string;
}) {
  return (
    <div className="stack">
      <section className="card">
        <form className="inline-form" method="get">
          <select name="unit" defaultValue={selectedUnit}>
            <option value="">全部單位</option>
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={selectedStatus}>
            <option value="">全部狀態</option>
            <option value="pending">未完成</option>
            <option value="completed">已完成</option>
          </select>
          <button type="submit">篩選</button>
        </form>
      </section>

      <section className="card">
        <h2>人員統計</h2>
        {stats.length === 0 ? (
          <p className="meta">尚無完成統計</p>
        ) : (
          <ul>
            {stats.map((row) => (
              <li key={row.accountId}>
                {row.displayName}：完成 {row.completedCount}，逾期完成{" "}
                {row.overdueCompletedCount}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>歷史工作（{works.length}）</h2>
        <div className="work-list">
          {works.map((work) => (
            <article key={work.id} className="account-item">
              <strong>{work.title}</strong>
              <p>
                {work.unit} · {work.status} · {work.priority}
                {work.completedByDisplayName
                  ? ` · ${work.completedByDisplayName}`
                  : ""}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>匯出 CSV</h2>
        <textarea readOnly rows={8} value={csv} className="span-2" />
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
          download="work-history.csv"
        >
          下載 CSV／Excel 可開
        </a>
      </section>
    </div>
  );
}
