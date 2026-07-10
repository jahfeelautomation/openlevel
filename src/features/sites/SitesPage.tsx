import { ArrowLeft, ChevronRight, ExternalLink, Globe, Plus } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type FunnelListItem,
  type FunnelStatus,
  type FunnelStep,
  type FunnelStepType,
  type Location,
  type NewFunnel,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { FunnelPreview } from './FunnelPreview'
import { NewFunnelDialog } from './NewFunnelDialog'
import { type DraftState, StepEditor } from './StepEditor'
import { stepMeta } from './sites-meta'

function readBrandColor(loc: Location | null): string {
  const c = loc?.branding.color
  return typeof c === 'string' ? c : '#4f46e5'
}

/**
 * Sites & Funnels — build the landing pages that capture leads. Three panes:
 * the funnel list (left), a live device preview of the selected page (center,
 * with a step-flow strip + publish control), and the page settings editor
 * (right). Editing the right pane re-renders the center preview instantly; the
 * public capture URL is `/f/<slug>/<path>`, the same data this preview renders.
 */
export function SitesPage() {
  const { current } = useTenant()
  const loc = current?.id
  const brandColor = readBrandColor(current)

  const [funnels, setFunnels] = useState<FunnelListItem[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null)

  const [steps, setSteps] = useState<FunnelStep[]>([])
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  const [draft, setDraft] = useState<DraftState | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [addingStep, setAddingStep] = useState(false)
  const [showNew, setShowNew] = useState(false)

  // Load the funnel list once per location; keep the open funnel if it survives.
  useEffect(() => {
    if (!loc) return
    let active = true
    setListStatus('loading')
    api
      .funnels(loc)
      .then((r) => {
        if (!active) return
        setFunnels(r.funnels)
        setListStatus(r.funnels.length > 0 ? 'ready' : 'empty')
        setSelectedFunnelId((prev) =>
          prev && r.funnels.some((f) => f.id === prev) ? prev : (r.funnels[0]?.id ?? null),
        )
      })
      .catch(() => active && setListStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  // Load the selected funnel's pages whenever the selection changes.
  useEffect(() => {
    if (!loc || !selectedFunnelId) {
      setSteps([])
      setSelectedStepId(null)
      return
    }
    let active = true
    api
      .funnel(loc, selectedFunnelId)
      .then((r) => {
        if (!active) return
        setSteps(r.steps)
        setSelectedStepId((prev) =>
          prev && r.steps.some((s) => s.id === prev) ? prev : (r.steps[0]?.id ?? null),
        )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc, selectedFunnelId])

  // Mirror the selected page into an editable draft (resets on save / reselect).
  useEffect(() => {
    const step = steps.find((s) => s.id === selectedStepId)
    if (!step) {
      setDraft(null)
      setDirty(false)
      return
    }
    setDraft({ name: step.name, path: step.path, type: step.type as FunnelStepType, content: step.content })
    setDirty(false)
  }, [selectedStepId, steps])

  const selectedFunnel = funnels.find((f) => f.id === selectedFunnelId) ?? null
  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? null
  const isPublished = selectedFunnel?.status === 'published'

  // The preview reflects the live draft so it updates as the operator types.
  const previewStep: FunnelStep | null =
    selectedStep && draft
      ? { ...selectedStep, name: draft.name, path: draft.path, type: draft.type, content: draft.content }
      : selectedStep

  async function handleCreate(input: NewFunnel) {
    if (!loc) return
    const r = await api.createFunnel(loc, input)
    setFunnels((prev) => [{ ...r.funnel, step_count: r.steps.length }, ...prev])
    setListStatus('ready')
    setSelectedFunnelId(r.funnel.id)
    setSteps(r.steps)
    setSelectedStepId(r.steps[0]?.id ?? null)
    setShowNew(false)
  }

  async function handleSaveStep() {
    if (!loc || !selectedFunnelId || !selectedStepId || !draft) return
    setSaving(true)
    try {
      const r = await api.updateFunnelStep(loc, selectedFunnelId, selectedStepId, {
        name: draft.name,
        path: draft.path,
        type: draft.type,
        content: draft.content,
      })
      setSteps((prev) => prev.map((s) => (s.id === r.step.id ? r.step : s)))
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!loc || !selectedFunnel) return
    const previous = selectedFunnel.status
    const next: FunnelStatus = previous === 'published' ? 'draft' : 'published'
    setPublishing(true)
    setFunnels((prev) => prev.map((f) => (f.id === selectedFunnel.id ? { ...f, status: next } : f)))
    try {
      const r = await api.updateFunnel(loc, selectedFunnel.id, { status: next })
      setFunnels((prev) => prev.map((f) => (f.id === r.funnel.id ? { ...f, ...r.funnel } : f)))
    } catch {
      setFunnels((prev) => prev.map((f) => (f.id === selectedFunnel.id ? { ...f, status: previous } : f)))
    } finally {
      setPublishing(false)
    }
  }

  async function handleAddStep() {
    if (!loc || !selectedFunnelId) return
    setAddingStep(true)
    try {
      const position = steps.length
      const r = await api.addFunnelStep(loc, selectedFunnelId, {
        name: 'New page',
        type: 'sales',
        path: `page-${position + 1}`,
        position,
        content: { headline: 'New page', body: '' },
      })
      setSteps((prev) => [...prev, r.step])
      setSelectedStepId(r.step.id)
      setFunnels((prev) =>
        prev.map((f) => (f.id === selectedFunnelId ? { ...f, step_count: f.step_count + 1 } : f)),
      )
    } finally {
      setAddingStep(false)
    }
  }

  if (listStatus === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — funnel list; hidden on mobile when a funnel is selected */}
      <div
        className={cn(
          'flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
          selectedFunnelId ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <h2 className="text-sm font-semibold text-slate-900">Funnels</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>
        <div className="ol-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {listStatus === 'empty' ? (
            <div className="px-3 py-10 text-center">
              <Globe className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No funnels yet.</p>
              <p className="text-xs text-slate-400">Create one to capture leads.</p>
            </div>
          ) : (
            funnels.map((f) => (
              <FunnelRow
                key={f.id}
                funnel={f}
                active={f.id === selectedFunnelId}
                onClick={() => setSelectedFunnelId(f.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Center + right — two-pane builder; stacks on mobile, side by side on desktop */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col lg:flex lg:flex-row',
          selectedFunnelId ? 'flex' : 'hidden',
        )}
      >
      {/* Center — preview + flow */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {selectedFunnel ? (
          <>
            {/* Mobile back affordance */}
            <button
              type="button"
              onClick={() => setSelectedFunnelId(null)}
              className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              All funnels
            </button>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-slate-900">
                    {selectedFunnel.name}
                  </h1>
                  <Badge variant={isPublished ? 'green' : 'slate'}>
                    {isPublished ? 'Published' : 'Draft'}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-xs text-slate-400">/f/{selectedFunnel.slug}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPublished && loc && (
                  <a
                    href={`/api/public/f/${loc}/${selectedFunnel.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the live page in a new tab"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View live
                  </a>
                )}
                <Button
                  variant={isPublished ? 'outline' : 'brand'}
                  size="sm"
                  disabled={publishing}
                  onClick={handleTogglePublish}
                >
                  {publishing ? 'Saving…' : isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </header>

            {/* Step-flow strip */}
            <div className="ol-scroll flex items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-5 py-3">
              {steps.map((s, i) => (
                <Fragment key={s.id}>
                  {i > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />}
                  <StepChip
                    step={s}
                    active={s.id === selectedStepId}
                    onClick={() => setSelectedStepId(s.id)}
                  />
                </Fragment>
              ))}
              <button
                type="button"
                onClick={handleAddStep}
                disabled={addingStep}
                className="ml-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Add page
              </button>
            </div>

            <div className="ol-scroll min-h-0 flex-1 overflow-y-auto p-8">
              <FunnelPreview step={previewStep} brandColor={brandColor} slug={selectedFunnel.slug} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <Globe className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No funnel selected</p>
              <p className="mt-1 text-sm text-slate-400">
                Pick a funnel on the left, or create a new one.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right — page editor */}
      {selectedFunnel && draft ? (
        <StepEditor
          draft={draft}
          slug={selectedFunnel.slug}
          dirty={dirty}
          saving={saving}
          onChange={(next) => {
            setDraft(next)
            setDirty(true)
          }}
          onSave={handleSaveStep}
        />
      ) : (
        <div className="flex w-full items-center justify-center border-t border-slate-200 bg-white p-6 text-center text-sm text-slate-400 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
          Select a page to edit it.
        </div>
      )}
      {/* end two-pane builder wrapper */}
      </div>

      {showNew && <NewFunnelDialog onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
    </div>
  )
}

function FunnelRow({
  funnel,
  active,
  onClick,
}: {
  funnel: FunnelListItem
  active: boolean
  onClick: () => void
}) {
  const published = funnel.status === 'published'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500',
        )}
      >
        <Globe className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{funnel.name}</span>
        <span className="block truncate text-xs text-slate-400">
          /f/{funnel.slug} · {funnel.step_count} {funnel.step_count === 1 ? 'page' : 'pages'}
        </span>
      </span>
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          published ? 'bg-emerald-500' : 'bg-slate-300',
        )}
        title={published ? 'Published' : 'Draft'}
      />
    </button>
  )
}

function StepChip({
  step,
  active,
  onClick,
}: {
  step: FunnelStep
  active: boolean
  onClick: () => void
}) {
  const meta = stepMeta(step.type)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400/30'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', meta.tile)}>
        <meta.icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block max-w-[10rem] truncate text-xs font-semibold text-slate-800">
          {step.name}
        </span>
        <span className="block text-[11px] text-slate-400">{meta.label}</span>
      </span>
    </button>
  )
}
