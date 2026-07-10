import { Search, User } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import type { Contact } from '../../lib/api'
import { cn } from '../../lib/utils'

const contactLabel = (c: Contact): string =>
  c.name?.trim() ||
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
  c.phones[0] ||
  c.emails[0] ||
  'Unnamed contact'

/**
 * Pick a contact to push through the workflow now (a manual test run). Lists the
 * location's contacts with a quick filter; clicking one enrolls it immediately.
 * This runs the workflow regardless of its draft/live status — it's a test.
 */
export function TestRunDialog({
  contacts,
  workflowName,
  busy,
  onCancel,
  onRun,
}: {
  contacts: Contact[]
  workflowName: string
  busy: boolean
  onCancel: () => void
  onRun: (contactId: string) => void
}) {
  const [q, setQ] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return contacts
    return contacts.filter((c) => contactLabel(c).toLowerCase().includes(needle))
  }, [contacts, q])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Test run</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pick a contact to run <span className="font-medium text-slate-700">{workflowName}</span>{' '}
            now. Steps execute for real — tags are applied and messages are logged.
          </p>
        </div>

        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts…"
              autoFocus
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          </div>
        </div>

        <div className="ol-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-400">No matching contacts.</p>
          ) : (
            filtered.map((c) => {
              const picked = c.id === pickedId
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPickedId(c.id)
                    onRun(c.id)
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed',
                    picked ? 'bg-brand-50' : 'hover:bg-slate-50',
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    <User className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{contactLabel(c)}</p>
                    {(c.phones[0] || c.emails[0]) && (
                      <p className="truncate text-[11px] text-slate-500">
                        {c.phones[0] ?? c.emails[0]}
                      </p>
                    )}
                  </div>
                  {picked && busy && <span className="text-[11px] text-brand-600">Running…</span>}
                </button>
              )
            })
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
