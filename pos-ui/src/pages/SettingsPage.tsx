import { Link } from 'react-router-dom'

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-semibold">POS 設定</h1>
      <p className="text-sm text-slate-600">
        積分折抵請到「會員管理」；可售目錄請到「可售商品」。示範重置仍使用員工網站側欄舊頁（僅系統管理員）。
      </p>
      <div className="flex flex-col gap-2">
        <Link to="/members" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          會員／積分設定 →
        </Link>
        <Link to="/products" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          可售商品 →
        </Link>
        <Link to="/pos" className="rounded-md bg-sky-600 px-3 py-2 text-center text-sm text-white">
          返回收銀
        </Link>
      </div>
    </div>
  )
}
