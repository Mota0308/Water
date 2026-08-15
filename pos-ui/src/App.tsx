import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { MembersPage } from '@/pages/MembersPage'
import { PosPage } from '@/pages/PosPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { ReceiptPage } from '@/pages/ReceiptPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SettlementPage } from '@/pages/SettlementPage'
import { TransactionsPage } from '@/pages/TransactionsPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/pos" replace />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/settlement" element={<SettlementPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/receipt/:id" element={<ReceiptPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      <Toaster richColors position="top-center" />
    </HashRouter>
  )
}
