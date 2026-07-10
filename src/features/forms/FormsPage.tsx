import { ArrowLeft, ClipboardList, ExternalLink, Inbox, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner, Spinner } from '../../components/ui/spinner'
import {
  type Form,
  type FormStatus,
  type FormSubmission,
  type Location,
  type NewForm,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { FormEditor, type FormDraft } from './FormEditor'
import { FormPreview } from './FormPreview'
import { NewFormDialog } from './NewFormDialog'
import { SubmissionsTable } from './SubmissionsTable'

function readBrandColor(loc: Location | null): string {
  const c = loc?.branding.color
  return typeof c === 'string' ? c : '#4f46e5'
}

type Tab = 'build' | 'submissions'

interface Detail {
  form: Form
  submissions: FormSubmission[]
}

/**
 * Forms & Surveys — standalone lead-capture forms. Three panes: the form list
 * (left), the selected form's workspace (center, with Build | Submissions tabs
 * and a publish control), and the settings editor (right). Editing the right
 * pane re-renders the Build preview instantly. Unlike a funnel, a form is
 * single-page and STORES every submission — the Submissions tab reads those real
 * rows back, and the counter beside it is that same honest number.
 */
export function FormsPage() {
  const { current } = useTenant()
  const loc = current?.id
  const brandColor = readBrandColor(current)

  const [forms, setForms] = useState<Form[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)

  // Loaded per selection: the authoritative form-for-editing plus its stored
  // submissions. The draft mirrors detail.form; publish never touches detail, so
  // toggling published doesn't disturb an unsaved edit.
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [tab, setTab] = useState<Tab>('build')
  const [showNew, setShowNew] = useState(false)

  // Load the form list once per location; keep the open form if it survives.
  useEffect(() => {
    if (!loc) return
    let active = true
    setListStatus('loading')
    api
      .forms(loc)
      .then((r) => {
        if (!active) return
        setForms(r.forms)
        setListStatus(r.forms.length > 0 ? 'ready' : 'empty')
        setSelectedFormId((prev) =>
          prev && r.forms.some((f) => f.id === prev) ? prev : (r.forms[0]?.id ?? null),
        )
      })
      .catch(() => active && setListStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  // Load the selected form's content + submissions whenever the selection changes.
  useEffect(() => {
    if (!loc || !selectedFormId) {
      setDetail(null)
      return
    }
    let active = true
    api
      .form(loc, selectedFormId)
      .then((r) => {
        if (active) setDetail(r)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc, selectedFormId])

  // Mirror the loaded form into an editable draft (resets on save / reselect).
  useEffect(() => {
    if (!detail) {
      setDraft(null)
      setDirty(false)
      return
    }
    setDraft({ name: detail.form.name, content: detail.form.content })
    setDirty(false)
  }, [detail])

  const selectedForm = forms.find((f) => f.id === selectedFormId) ?? null
  const isPublished = selectedForm?.status === 'published'
  const submissionCount = selectedForm?.submissions ?? 0

  async function handleCreate(input: NewForm) {
    if (!loc) return
    const r = await api.createForm(loc, input)
    setForms((prev) => [r.form, ...prev])
    setListStatus('ready')
    setSelectedFormId(r.form.id)
    setTab('build')
    setShowNew(false)
  }

  async function handleSave() {
    if (!loc || !selectedFormId || !draft) return
    setSaving(true)
    try {
      const r = await api.updateForm(loc, selectedFormId, {
        name: draft.name,
        content: draft.content,
      })
      // Refresh detail (re-mirrors the draft, clears dirty) and the list row.
      setDetail((d) => (d ? { ...d, form: r.form } : d))
      setForms((prev) => prev.map((f) => (f.id === r.form.id ? r.form : f)))
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!loc || !selectedForm) return
    const previous = selectedForm.status
    const next: FormStatus = previous === 'published' ? 'draft' : 'published'
    setPublishing(true)
    // Optimistic on the list row only — detail/draft are left untouched so an
    // in-progress edit survives a publish toggle.
    setForms((prev) => prev.map((f) => (f.id === selectedForm.id ? { ...f, status: next } : f)))
    try {
      const r = await api.updateForm(loc, selectedForm.id, { status: next })
      setForms((prev) => prev.map((f) => (f.id === r.form.id ? { ...f, status: r.form.status } : f)))
    } catch {
      setForms((prev) =>
        prev.map((f) => (f.id === selectedForm.id ? { ...f, status: previous } : f)),
      )
    } finally {
      setPublishing(false)
    }
  }

  if (listStatus === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — form list; hidden on mobile when a form is selected */}
      <div
        className={cn(
          'flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
          selectedFormId ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <h2 className="text-sm font-semibold text-slate-900">Forms</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>
        <div className="ol-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {listStatus === 'empty' ? (
            <div className="px-3 py-10 text-center">
              <ClipboardList className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No forms yet.</p>
              <p className="text-xs text-slate-400">Create one to capture leads.</p>
            </div>
          ) : (
            forms.map((f) => (
              <FormRow
                key={f.id}
                form={f}
                active={f.id === selectedFormId}
                onClick={() => setSelectedFormId(f.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Center + right — two-pane builder; stacks on mobile, side by side on desktop */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col lg:flex lg:flex-row',
          selectedFormId ? 'flex' : 'hidden',
        )}
      >
      {/* Center — tabs + preview / submissions */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {selectedForm ? (
          <>
            {/* Mobile back affordance */}
            <button
              type="button"
              onClick={() => setSelectedFormId(null)}
              className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              All forms
            </button>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-slate-900">
                    {selectedForm.name}
                  </h1>
                  <Badge variant={isPublished ? 'green' : 'slate'}>
                    {isPublished ? 'Published' : 'Draft'}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-xs text-slate-400">/forms/{selectedForm.slug}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPublished && loc && (
                  <a
                    href={`/api/public/forms/${loc}/${selectedForm.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the live form in a new tab"
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

            {/* Tab strip */}
            <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-5">
              <TabButton active={tab === 'build'} onClick={() => setTab('build')}>
                Build
              </TabButton>
              <TabButton active={tab === 'submissions'} onClick={() => setTab('submissions')}>
                Submissions
                <span
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                    tab === 'submissions'
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {submissionCount}
                </span>
              </TabButton>
            </div>

            <div className="ol-scroll min-h-0 flex-1 overflow-y-auto p-8">
              {tab === 'build' ? (
                draft ? (
                  <FormPreview
                    content={draft.content}
                    name={draft.name}
                    brandColor={brandColor}
                    slug={selectedForm.slug}
                  />
                ) : (
                  <div className="flex items-center justify-center py-24">
                    <Spinner className="h-6 w-6" />
                  </div>
                )
              ) : detail ? (
                <SubmissionsTable form={detail.form} submissions={detail.submissions} />
              ) : (
                <div className="flex items-center justify-center py-24">
                  <Spinner className="h-6 w-6" />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <Inbox className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No form selected</p>
              <p className="mt-1 text-sm text-slate-400">
                Pick a form on the left, or create a new one.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right — settings editor (Build tab only) */}
      {selectedForm && draft && tab === 'build' ? (
        <FormEditor
          draft={draft}
          dirty={dirty}
          saving={saving}
          onChange={(next) => {
            setDraft(next)
            setDirty(true)
          }}
          onSave={handleSave}
        />
      ) : (
        <div className="flex w-full items-center justify-center border-t border-slate-200 bg-white p-6 text-center text-sm text-slate-400 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
          {tab === 'submissions' ? 'Switch to Build to edit this form.' : 'Select a form to edit it.'}
        </div>
      )}
      {/* end two-pane builder wrapper */}
      </div>

      {showNew && <NewFormDialog onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center border-b-2 px-1 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-brand-500 text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function FormRow({
  form,
  active,
  onClick,
}: {
  form: Form
  active: boolean
  onClick: () => void
}) {
  const published = form.status === 'published'
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
        <ClipboardList className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{form.name}</span>
        <span className="block truncate text-xs text-slate-400">
          /forms/{form.slug} · {form.submissions}{' '}
          {form.submissions === 1 ? 'submission' : 'submissions'}
        </span>
      </span>
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', published ? 'bg-emerald-500' : 'bg-slate-300')}
        title={published ? 'Published' : 'Draft'}
      />
    </button>
  )
}
