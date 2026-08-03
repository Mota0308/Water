"use client";

import type {
  StaffStatView,
  WorkView,
} from "@/application/store-work-flow-app";

export function HistoryPanel({
  units,
  selectedUnit,
  selectedStatus,
  selectedPriority,
  selectedType,
  overdueOnly,
  works,
  stats,
  csv,
}: {
  units: string[];
  selectedUnit: string;
  selectedStatus: string;
  selectedPriority: string;
  selectedType: string;
  overdueOnly: boolean;
  works: WorkView[];
  stats: StaffStatView[];
  csv: string;
}) {
  return (
    <div className="stack">
      <section className="personal-card">
        <h2 className="personal-card-title">篩選</h2>
        <form className="inline-form wrap records-filter" method="get">
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
          <select name="priority" defaultValue={selectedPriority}>
            <option value="">全部優先程度</option>
            <option value="normal">一般</option>
            <option value="important">重要</option>
            <option value="urgent">緊急</option>
          </select>
          <select name="type" defaultValue={selectedType}>
            <option value="">全部類型</option>
            <option value="adhoc">突發</option>
            <option value="recurring">恆常</option>
            <option value="daily_settlement">每日結算</option>
          </select>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="overdue"
              value="1"
              defaultChecked={overdueOnly}
            />
            僅逾期
          </label>
          <button type="submit">篩選</button>
        </form>
      </section>

      <section className="personal-card">
        <h2 className="personal-card-title">人員統計</h2>
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

      <section className="personal-card">
        <h2 className="personal-card-title">歷史工作（{works.length}）</h2>
        <div className="work-list">
          {works.map((work) => (
            <article key={work.id} className="shell-item">
              <strong>
                <a href={`/work/${work.id}`}>{work.title}</a>
              </strong>
              <p className="meta">
                {work.unit} · {work.status} · {work.priority} · {work.type}
                {work.completedByDisplayName
                  ? ` · ${work.completedByDisplayName}`
                  : ""}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="personal-card">
        <h2 className="personal-card-title">匯出 CSV</h2>
        <p className="meta">下載 CSV，可用 Excel 開啟</p>
        <textarea readOnly rows={8} value={csv} className="shell-textarea" />
        <p>
          <a
            className="text-btn"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
            download="work-history.csv"
          >
            下載 CSV
          </a>
        </p>
      </section>
    </div>
  );
}
