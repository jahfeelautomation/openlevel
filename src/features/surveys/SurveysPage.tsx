import { ArrowLeft, ExternalLink, Inbox, ListChecks, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageSpinner, Spinner } from '../../components/ui/spinner'
import {
  type Location,
  type NewSurvey,
  type Survey,
  type SurveyStatus,
  type SurveySubmission,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { NewSurveyDialog } from './NewSurveyDialog'
import { SurveyEditor, type SurveyDraft } from './SurveyEditor'
import { SurveyPreview } from './SurveyPreview'
import { SurveySubmissionsTable } from './SurveySubmissionsTable'

function readBrandColor(loc: Location | null): string {
  const c = loc?.branding.color
  return typeof c === 'string' ? c : '#4f46e5'
}

type Tab = 'build' | 'submissions'

interface Detail {
  survey: Survey
  submissions: SurveySubmission[]
}

/** A short summary of how many questions a survey holds across its steps — an
 *  honest count read straight off the structure, never a stored figure. */
function questionCount(survey: Survey): number {
  return (survey.content.steps ?? []).reduce((n, s) => n + (s.fields ?? []).length, 0)
}

/**
 * Surveys — multi-step, hosted questionnaires. Three panes: the survey list
 * (left), the selected survey's workspace (center, with Build | Submissions tabs
 * and a publish control), and the multi-step builder (right). Editing the right
 * pane re-renders the Build preview instantly. Like a form, a survey STORES every
 * completed submission — the Submissions tab reads those real rows back, and the
 * counter beside it is that same honest number.
 */
export function SurveysPage() {
  const { current } = useTenant()
  const loc = current?.id
  const brandColor = readBrandColor(current)

  const [surveys, setSurveys] = useState<Survey[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Loaded per selection: the authoritative survey-for-editing plus its stored
  // submissions. The draft mirrors detail.survey; publish never touches detail, so
  // toggling published doesn't disturb an unsaved edit.
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<SurveyDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [tab, setTab] = useState<Tab>('build')
  const [showNew, setShowNew] = useState(false)

  // Load the survey list once per location; keep the open survey if it survives.
  useEffect(() => {
    if (!loc) return
    let active = true
    setListStatus('loading')
    api
      .surveys(loc)
      .then((r) => {
        if (!active) return
        setSurveys(r.surveys)
        setListStatus(r.surveys.length > 0 ? 'ready' : 'empty')
        setSelectedId((prev) =>
          prev && r.surveys.some((s) => s.id === prev) ? prev : (r.surveys[0]?.id ?? null),
        )
      })
      .catch(() => active && setListStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  // Load the selected survey's content + submissions whenever the selection changes.
  useEffect(() => {
    if (!loc || !selectedId) {
      setDetail(null)
      return
    }
    let active = true
    api
      .survey(loc, selectedId)
      .then((r) => {
        if (active) setDetail(r)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc, selectedId])

  // Mirror the loaded survey into an editable draft (resets on save / reselect).
  useEffect(() => {
    if (!detail) {
      setDraft(null)
      setDirty(false)
      return
    }
    setDraft({ name: detail.survey.name, content: detail.survey.content })
    setDirty(false)
  }, [detail])

  const selectedSurvey = surveys.find((s) => s.id === selectedId) ?? null
  const isPublished = selectedSurvey?.status === 'published'
  const submissionCount = selectedSurvey?.submissions ?? 0

  async function handleCreate(input: NewSurvey) {
    if (!loc) return
    const r = await api.createSurvey(loc, input)
    setSurveys((prev) => [r.survey, ...prev])
    setListStatus('ready')
    setSelectedId(r.survey.id)
    setTab('build')
    setShowNew(false)
  }

  async function handleSave() {
    if (!loc || !selectedId || !draft) return
    setSaving(true)
    try {
      const r = await api.updateSurvey(loc, selectedId, {
        name: draft.name,
        content: draft.content,
      })
      // Refresh detail (re-mirrors the draft, clears dirty) and the list row.
      setDetail((d) => (d ? { ...d, survey: r.survey } : d))
      setSurveys((prev) => prev.map((s) => (s.id === r.survey.id ? r.survey : s)))
    } finally {
      setSaving(false)
    }
  }

  async function handleTogglePublish() {
    if (!loc || !selectedSurvey) return
    const previous = selectedSurvey.status
    const next: SurveyStatus = previous === 'published' ? 'draft' : 'published'
    setPublishing(true)
    // Optimistic on the list row only — detail/draft are left untouched so an
    // in-progress edit survives a publish toggle.
    setSurveys((prev) => prev.map((s) => (s.id === selectedSurvey.id ? { ...s, status: next } : s)))
    try {
      const r = await api.updateSurvey(loc, selectedSurvey.id, { status: next })
      setSurveys((prev) =>
        prev.map((s) => (s.id === r.survey.id ? { ...s, status: r.survey.status } : s)),
      )
    } catch {
      setSurveys((prev) =>
        prev.map((s) => (s.id === selectedSurvey.id ? { ...s, status: previous } : s)),
      )
    } finally {
      setPublishing(false)
    }
  }

  if (listStatus === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — survey list; hidden on mobile when a survey is selected */}
      <div
        className={cn(
          'flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
          selectedId ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
          <h2 className="text-sm font-semibold text-slate-900">Surveys</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>
        <div className="ol-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {listStatus === 'empty' ? (
            <div className="px-3 py-10 text-center">
              <ListChecks className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No surveys yet.</p>
              <p className="text-xs text-slate-400">Create one to qualify leads.</p>
            </div>
          ) : (
            surveys.map((s) => (
              <SurveyRow
                key={s.id}
                survey={s}
                active={s.id === selectedId}
                onClick={() => setSelectedId(s.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Center + right — two-pane builder; stacks on mobile, side by side on desktop */}
      <div
        className={cn(
          'min-w-0 flex-1 flex-col lg:flex lg:flex-row',
          selectedId ? 'flex' : 'hidden',
        )}
      >
      {/* Center — tabs + preview / submissions */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {selectedSurvey ? (
          <>
            {/* Mobile back affordance */}
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              All surveys
            </button>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-slate-900">
                    {selectedSurvey.name}
                  </h1>
                  <Badge variant={isPublished ? 'green' : 'slate'}>
                    {isPublished ? 'Published' : 'Draft'}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-xs text-slate-400">
                  /surveys/{selectedSurvey.slug}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPublished && loc && (
                  <a
                    href={`/api/public/surveys/${loc}/${selectedSurvey.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the live survey in a new tab"
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
                  <SurveyPreview
                    content={draft.content}
                    name={draft.name}
                    brandColor={brandColor}
                    slug={selectedSurvey.slug}
                  />
                ) : (
                  <div className="flex items-center justify-center py-24">
                    <Spinner className="h-6 w-6" />
                  </div>
                )
              ) : detail ? (
                <SurveySubmissionsTable survey={detail.survey} submissions={detail.submissions} />
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
              <p className="mt-3 text-sm font-medium text-slate-600">No survey selected</p>
              <p className="mt-1 text-sm text-slate-400">
                Pick a survey on the left, or create a new one.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right — multi-step builder (Build tab only) */}
      {selectedSurvey && draft && tab === 'build' ? (
        <SurveyEditor
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
        <div className="flex w-full items-center justify-center border-t border-slate-200 bg-white p-6 text-center text-sm text-slate-400 lg:w-96 lg:shrink-0 lg:border-l lg:border-t-0">
          {tab === 'submissions'
            ? 'Switch to Build to edit this survey.'
            : 'Select a survey to edit it.'}
        </div>
      )}
      {/* end two-pane builder wrapper */}
      </div>

      {showNew && <NewSurveyDialog onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
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

function SurveyRow({
  survey,
  active,
  onClick,
}: {
  survey: Survey
  active: boolean
  onClick: () => void
}) {
  const published = survey.status === 'published'
  const questions = questionCount(survey)
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
        <ListChecks className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{survey.name}</span>
        <span className="block truncate text-xs text-slate-400">
          {questions} {questions === 1 ? 'question' : 'questions'} · {survey.submissions}{' '}
          {survey.submissions === 1 ? 'response' : 'responses'}
        </span>
      </span>
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', published ? 'bg-emerald-500' : 'bg-slate-300')}
        title={published ? 'Published' : 'Draft'}
      />
    </button>
  )
}
