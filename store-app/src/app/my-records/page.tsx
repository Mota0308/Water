import { redirect } from "next/navigation";
import { PersonalShell } from "@/components/personal-shell";
import { getStoreWorkFlowApp } from "@/infrastructure/app";
import { readSessionId } from "@/infrastructure/session-cookie";

function hongKongDayBounds(dateKey: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  // Asia/Hong_Kong is UTC+8 without DST
  const from = new Date(`${dateKey}T00:00:00+08:00`);
  const to = new Date(`${dateKey}T23:59:59.999+08:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

function todayHongKongKey(): string {
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Hong_Kong",
  }).slice(0, 10);
}

export default async function MyRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sessionId = await readSessionId();
  const app = await getStoreWorkFlowApp();
  const auth = await app.requireSession(sessionId);
  if (!auth.ok) redirect("/login");
  if (auth.session.role !== "personal") redirect("/");

  const params = await searchParams;
  const todayKey = todayHongKongKey();
  const fromKey = params.from || todayKey;
  const toKey = params.to || fromKey;
  const fromBounds = hongKongDayBounds(fromKey);
  const toBounds = hongKongDayBounds(toKey);

  const result = await app.listMyCompletions(auth.session.sessionId, {
    from: fromBounds?.from,
    to: toBounds?.to ?? fromBounds?.to,
  });
  const completions = result.ok ? result.completions : [];
  const isTodayOnly = fromKey === todayKey && toKey === todayKey;

  return (
    <PersonalShell session={auth.session} active="records">
      <section className="personal-card">
        <h1 className="personal-card-title">
          我的完成記錄{isTodayOnly ? "（今日）" : ""}
        </h1>
        <form className="records-filter" method="get">
          <label>
            由
            <input type="date" name="from" defaultValue={fromKey} />
          </label>
          <label>
            至
            <input type="date" name="to" defaultValue={toKey} />
          </label>
          <button type="submit">查詢</button>
          <a className="text-btn" href="/my-records">
            今日
          </a>
        </form>

        {completions.length === 0 ? (
          <p className="meta">此期間沒有完成記錄。</p>
        ) : (
          <div className="records-table-wrap">
            <table className="records-table">
              <thead>
                <tr>
                  <th>工作名稱</th>
                  <th>單位</th>
                  <th>完成時間</th>
                  <th>是否準時</th>
                </tr>
              </thead>
              <tbody>
                {completions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a href={`/work/${row.id}`}>{row.title}</a>
                    </td>
                    <td>{row.unit}</td>
                    <td>
                      {row.completedAt.toLocaleString("zh-HK", {
                        hour: "2-digit",
                        minute: "2-digit",
                        month: "numeric",
                        day: "numeric",
                        hour12: false,
                        timeZone: "Asia/Hong_Kong",
                      })}
                    </td>
                    <td>
                      <span
                        className={
                          row.onTime ? "pill status-ontime" : "pill status-late"
                        }
                      >
                        {row.onTime ? "準時" : "逾期"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PersonalShell>
  );
}
