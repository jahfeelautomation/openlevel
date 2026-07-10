import { Banknote, Package, Receipt, Repeat, Ticket } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/utils'

interface PaymentsTab {
  to: string
  label: string
  icon: typeof Receipt
}

// Payments groups the money-side surfaces the way GHL does: the invoices you
// bill, the reusable product/service catalog those invoices are built from, and
// the recurring subscriptions a contact is on. A horizontal tab strip (not a
// second vertical sidebar) keeps the full width for the invoice three-pane and
// the catalog/subscription lists underneath.
const PAYMENTS_TABS: PaymentsTab[] = [
  { to: '/payments/invoices', label: 'Invoices', icon: Receipt },
  { to: '/payments/products', label: 'Products', icon: Package },
  { to: '/payments/subscriptions', label: 'Subscriptions', icon: Repeat },
  { to: '/payments/coupons', label: 'Coupons', icon: Ticket },
  { to: '/payments/transactions', label: 'Transactions', icon: Banknote },
]

/**
 * The Payments section frame: a thin tab strip across the top, with the chosen
 * page rendered below via <Outlet/>. Sits inside the app shell's main area and
 * fills the height it is given, so each tab's page keeps its own full-height
 * layout.
 */
export function PaymentsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="ol-scroll flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4">
        {PAYMENTS_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                '-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
