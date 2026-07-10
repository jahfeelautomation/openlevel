import { ChevronDown, ChevronUp, GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageSpinner } from '../../components/ui/spinner'
import { ApiError, type Pipeline, api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'

type EditTarget = { kind: 'pipeline' | 'stage'; id: string }

/**
 * Pipelines — the deal-stage manager (GHL Settings -> Pipelines). An operator
 * builds the pipelines and the ordered stages a deal moves through; the
 * Opportunities board then reads this structure. Every change here is structural
 * only: it never sends a message or moves money.
 *
 * Deletes are guarded server-side — a location keeps at least one pipeline, a
 * pipeline keeps at least one stage, and neither a pipeline nor a stage that
 * still holds opportunities can be removed. The API answers those refusals with a
 * 409 and a plain reason, which we surface verbatim in the banner instead of
 * pretending the delete worked.
 */
export function PipelinesSettingsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [confirm, setConfirm] = useState<EditTarget | null>(null)
  const [addingStageTo, setAddingStageTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!loc) return
    const r = await api.managePipelines(loc)
    setPipelines(r.pipelines)
  }, [loc])

  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    setCreating(false)
    setEditing(null)
    setConfirm(null)
    setAddingStageTo(null)
    api
      .managePipelines(loc)
      .then((r) => {
        if (!active) return
        setPipelines(r.pipelines)
        setStatus('ready')
      })
      .catch(() => active && setStatus('ready'))
    return () => {
      active = false
    }
  }, [loc])

  // One mutation runner: clears transient UI, surfaces the server's honest 409
  // message (a guarded-delete refusal) verbatim, and refreshes on success. The
  // callback receives a narrowed non-null loc so callers stay terse.
  async function act(fn: (loc: string) => Promise<unknown>) {
    if (!loc || busy) return
    setBusy(true)
    setError(null)
    try {
      await fn(loc)
      setCreating(false)
      setEditing(null)
      setConfirm(null)
      setAddingStageTo(null)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function moveStage(p: Pipeline, index: number, dir: -1 | 1) {
    const next = index + dir
    if (next < 0 || next >= p.stages.length) return
    const ids = p.stages.map((s) => s.id)
    const here = ids[index]!
    ids[index] = ids[next]!
    ids[next] = here
    void act((l) => api.reorderStages(l, p.id, ids))
  }

  function startCreate() {
    setCreating(true)
    setEditing(null)
    setConfirm(null)
    setAddingStageTo(null)
    setError(null)
  }

  if (!loc || status === 'loading') return <PageSpinner label="Loading pipelines" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Pipelines</h1>
          <p className="text-xs text-slate-500">
            The stages a deal moves through. Opportunities sit on these stages in the board.
          </p>
        </div>
        {!creating ? (
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            Add pipeline
          </Button>
        ) : null}
      </header>

      <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {error ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5">
              <p className="text-xs font-medium text-rose-700">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="shrink-0 text-xs font-medium text-rose-500 hover:text-rose-700"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {creating ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New pipeline</h2>
              <NameForm
                submitLabel="Create pipeline"
                placeholder="e.g. Cash Offer Pipeline"
                busy={busy}
                onSubmit={(name) => void act((l) => api.createPipeline(l, name))}
                onCancel={() => setCreating(false)}
              />
              <p className="mt-2 text-xs text-slate-400">
                A new pipeline starts with one stage you can rename. Add more below once it exists.
              </p>
            </div>
          ) : null}

          {pipelines.length === 0 && !creating ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <GitBranch className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No pipelines yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create a pipeline to define the stages your deals move through.
              </p>
            </div>
          ) : (
            pipelines.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  {editing?.kind === 'pipeline' && editing.id === p.id ? (
                    <NameForm
                      initial={p.name}
                      submitLabel="Save"
                      placeholder="Pipeline name"
                      busy={busy}
                      onSubmit={(name) => void act((l) => api.renamePipeline(l, p.id, name))}
                      onCancel={() => setEditing(null)}
                    />
                  ) : confirm?.kind === 'pipeline' && confirm.id === p.id ? (
                    <ConfirmRow
                      label={p.name}
                      kind="pipeline"
                      busy={busy}
                      onCancel={() => setConfirm(null)}
                      onConfirm={() => void act((l) => api.deletePipeline(l, p.id))}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                          <GitBranch className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            {p.stages.length} {p.stages.length === 1 ? 'stage' : 'stages'}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconBtn
                          title="Rename pipeline"
                          onClick={() => {
                            setEditing({ kind: 'pipeline', id: p.id })
                            setConfirm(null)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn
                          title="Delete pipeline"
                          onClick={() => {
                            setConfirm({ kind: 'pipeline', id: p.id })
                            setEditing(null)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconBtn>
                      </div>
                    </>
                  )}
                </div>

                <ul className="divide-y divide-slate-100">
                  {p.stages.map((s, i) => (
                    <li key={s.id} className="px-4 py-2.5">
                      {editing?.kind === 'stage' && editing.id === s.id ? (
                        <NameForm
                          initial={s.name}
                          submitLabel="Save"
                          placeholder="Stage name"
                          busy={busy}
                          onSubmit={(name) => void act((l) => api.renameStage(l, s.id, name))}
                          onCancel={() => setEditing(null)}
                        />
                      ) : confirm?.kind === 'stage' && confirm.id === s.id ? (
                        <ConfirmRow
                          label={s.name}
                          kind="stage"
                          busy={busy}
                          onCancel={() => setConfirm(null)}
                          onConfirm={() => void act((l) => api.deleteStage(l, s.id))}
                        />
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500">
                              {i + 1}
                            </span>
                            <span className="truncate text-sm text-slate-700">{s.name}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <IconBtn
                              title="Move up"
                              disabled={i === 0}
                              onClick={() => moveStage(p, i, -1)}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Move down"
                              disabled={i === p.stages.length - 1}
                              onClick={() => moveStage(p, i, 1)}
                            >
                              <ChevronDown className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Rename stage"
                              onClick={() => {
                                setEditing({ kind: 'stage', id: s.id })
                                setConfirm(null)
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn
                              title="Delete stage"
                              onClick={() => {
                                setConfirm({ kind: 'stage', id: s.id })
                                setEditing(null)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconBtn>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="border-t border-slate-100 px-4 py-2.5">
                  {addingStageTo === p.id ? (
                    <NameForm
                      submitLabel="Add stage"
                      placeholder="e.g. Contract Sent"
                      busy={busy}
                      onSubmit={(name) => void act((l) => api.addStage(l, p.id, name))}
                      onCancel={() => setAddingStageTo(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingStageTo(p.id)
                        setEditing(null)
                        setConfirm(null)
                      }}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
                    >
                      <Plus className="h-4 w-4" />
                      Add stage
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Shared single-field name form used for creating/renaming a pipeline and
 * adding/renaming a stage. Enter submits, Escape cancels.
 */
function NameForm({
  initial,
  submitLabel,
  placeholder,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: string
  submitLabel: string
  placeholder: string
  busy: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial ?? '')
  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !busy

  function submit() {
    if (canSubmit) onSubmit(trimmed)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        value={name}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKey}
      />
      <Button size="sm" disabled={!canSubmit} onClick={submit}>
        {submitLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

/** The delete-confirm inline row. The honest reason a delete might be refused
 *  (last of its kind, or still holds opportunities) comes back from the server as
 *  a 409 and shows in the page banner; this only asks to proceed. */
function ConfirmRow({
  label,
  kind,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string
  kind: 'pipeline' | 'stage'
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="text-sm text-rose-700">
        Delete {kind} <span className="font-semibold">{label}</span>?
      </span>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onConfirm}>
          Delete
        </Button>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        disabled
          ? 'cursor-not-allowed text-slate-200'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  )
}
