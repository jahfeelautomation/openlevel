import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileSignature,
  Globe,
  GraduationCap,
  Handshake,
  LayoutTemplate,
  Link2,
  ListChecks,
  ListTodo,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquare,
  MessagesSquare,
  Megaphone,
  Newspaper,
  Phone,
  Receipt,
  Settings,
  Share2,
  Sparkles,
  Star,
  Tags,
  Target,
  Users,
  Workflow,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Avatar } from '../../components/ui/avatar'
import { cn } from '../../lib/utils'
import { useAuth } from '../../state/auth'
import { LocationSwitcher } from './LocationSwitcher'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  soon?: boolean
}

// Conversations + Contacts are live in slice 1; the rest are the GHL surface
// area we're building toward, shown with a "soon" tag (never as working links).
const NAV: NavItem[] = [
  { to: '/assistant', label: 'Assistant', icon: Sparkles },
  { to: '/conversations', label: 'Conversations', icon: MessageSquare },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/tags', label: 'Tags', icon: Tags },
  { to: '/opportunities', label: 'Opportunities', icon: Target },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/calendars', label: 'Calendars', icon: CalendarDays },
  { to: '/calls', label: 'Calls', icon: Phone },
  { to: '/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/social', label: 'Social Planner', icon: Share2 },
  { to: '/automations', label: 'Automations', icon: Workflow },
  { to: '/reporting', label: 'Dashboard', icon: BarChart3 },
  { to: '/sites', label: 'Sites & Funnels', icon: Globe },
  { to: '/forms', label: 'Forms', icon: ClipboardList },
  { to: '/surveys', label: 'Surveys', icon: ListChecks },
  { to: '/payments', label: 'Payments', icon: Receipt },
  { to: '/proposals', label: 'Proposals', icon: FileSignature },
  { to: '/reputation', label: 'Reputation', icon: Star },
  { to: '/memberships', label: 'Memberships', icon: GraduationCap },
  { to: '/communities', label: 'Communities', icon: MessagesSquare },
  { to: '/blog', label: 'Blog', icon: Newspaper },
  { to: '/trigger-links', label: 'Trigger Links', icon: Link2 },
  { to: '/affiliates', label: 'Affiliates', icon: Handshake },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavRow({ item }: { item: NavItem }) {
  const base =
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors'
  if (item.soon) {
    return (
      <div className={cn(base, 'cursor-default text-slate-500')} title="Coming soon">
        <item.icon className="h-[18px] w-[18px] text-slate-500" />
        <span className="flex-1">{item.label}</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          soon
        </span>
      </div>
    )
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          base,
          isActive
            ? 'bg-white/10 text-white'
            : 'text-slate-300 hover:bg-white/5 hover:text-white',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon
            className={cn('h-[18px] w-[18px]', isActive ? 'text-brand-300' : 'text-slate-400')}
          />
          <span className="flex-1">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

/** The persistent app frame: dark sidebar (brand + sub-account switcher + nav +
 *  operator) and a content area that renders the routed page via <Outlet/>.
 *  Below lg the sidebar is an off-canvas drawer behind a hamburger top bar —
 *  a permanently-visible w-64 aside would cover most of a phone screen. */
export function AppShell() {
  const { operator, logout } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()

  // A nav tap navigates; the drawer must not outlive the page it was opened on.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      {navOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-slate-900 transition-transform duration-200 lg:static lg:translate-x-0 lg:transition-none',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            OL
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">OpenLevel</span>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
            className="ml-auto rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <LocationSwitcher />
        </div>

        <nav className="ol-scroll flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={operator?.name ?? operator?.email ?? '?'} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {operator?.name ?? 'Operator'}
              </p>
              <p className="truncate text-xs text-slate-400">{operator?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              title="Sign out"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            OL
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900">OpenLevel</span>
        </header>
        <Outlet />
      </main>
    </div>
  )
}
