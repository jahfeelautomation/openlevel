import { Bot, Braces, CreditCard, GitBranch, type LucideIcon, Phone, Send, Share2, SlidersHorizontal } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../../lib/utils'

interface SettingsNavItem {
  to: string
  label: string
  icon: LucideIcon
  description: string
}

// Settings groups the location-configuration areas that used to sit in the main
// nav (Custom Fields, Custom Values) alongside Pipelines, matching GHL's
// information architecture: the dark left rail is for daily work, this lighter
// secondary rail is for set-up-once configuration.
const SETTINGS_NAV: SettingsNavItem[] = [
  {
    to: '/settings/agent',
    label: 'AI Agent',
    icon: Bot,
    description: 'How the assistant replies and acts',
  },
  {
    to: '/settings/payments',
    label: 'Payments',
    icon: CreditCard,
    description: 'Connect Stripe or Square',
  },
  {
    to: '/settings/sending',
    label: 'Email & SMS',
    icon: Send,
    description: 'Connect Brevo or Twilio',
  },
  {
    to: '/settings/social',
    label: 'Social',
    icon: Share2,
    description: 'Connect pages and profiles',
  },
  {
    to: '/settings/voice',
    label: 'Voice',
    icon: Phone,
    description: 'Connect Twilio or Vapi calling',
  },
  {
    to: '/settings/pipelines',
    label: 'Pipelines',
    icon: GitBranch,
    description: 'Stages a deal moves through',
  },
  {
    to: '/settings/custom-fields',
    label: 'Custom Fields',
    icon: SlidersHorizontal,
    description: 'Extra data on every contact',
  },
  {
    to: '/settings/custom-values',
    label: 'Custom Values',
    icon: Braces,
    description: 'Reusable merge-tag constants',
  },
]

/**
 * The Settings section frame: a light secondary sidebar listing the
 * configuration areas, with the chosen page rendered in the content column via
 * <Outlet/>. Sits inside the app shell's main area, so this is a row (sub-nav +
 * content) that fills the height it is given. Below lg the sidebar collapses
 * into a horizontally scrollable strip across the top so the page keeps the
 * full phone width.
 */
export function SettingsLayout() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:w-64 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-200 px-4 py-3 lg:px-5 lg:py-4">
          <h1 className="text-base font-semibold text-slate-900">Settings</h1>
          <p className="text-xs text-slate-500">Configure this sub-account</p>
        </div>
        <nav className="ol-scroll flex gap-1 overflow-x-auto p-2 lg:flex-1 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:p-3">
          {SETTINGS_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 transition-colors lg:items-start lg:gap-3 lg:py-2.5',
                  isActive ? 'bg-brand-50' : 'hover:bg-slate-50',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 lg:mt-0.5',
                      isActive ? 'text-brand-600' : 'text-slate-400',
                    )}
                  />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block whitespace-nowrap text-sm font-medium',
                        isActive ? 'text-brand-700' : 'text-slate-700',
                      )}
                    >
                      {item.label}
                    </span>
                    <span className="hidden text-xs text-slate-400 lg:block">
                      {item.description}
                    </span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
