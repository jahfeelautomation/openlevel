import { ArrowLeft, Play, Plus, Workflow as WorkflowIcon, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { PageSpinner } from '../../components/ui/spinner'
import {
  type Contact,
  type NewWorkflow,
  type Workflow,
  type WorkflowAction,
  type WorkflowActionInput,
  type WorkflowRun,
  type WorkflowStatus,
  api,
} from '../../lib/api'
import { cn } from '../../lib/utils'
import { useTenant } from '../../state/location'
import { AddStepDialog } from './AddStepDialog'
import { NewWorkflowDialog } from './NewWorkflowDialog'
import { RunsRail } from './RunsRail'
import { TestRunDialog } from './TestRunDialog'
import { actionMeta, actionSummary, triggerMeta } from './automation-meta'

const toInput = (a: WorkflowAction): WorkflowActionInput => ({
  type: a.type as WorkflowActionInput['type'],
  config: a.config,
})

export function AutomationsPage() {
  const { current } = useTenant()
  const loc = current?.id

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [steps, setSteps] = useState<WorkflowActionInput[]>([])
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [showNew, setShowNew] = useState(false)
  const [showAddStep, setShowAddStep] = useState(false)
  const [savingSteps, setSavingSteps] = useState(false)

  const [contacts, setContacts] = useState<Contact[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [showTestRun, setShowTestRun] = useState(false)
  const [testRunBusy, setTestRunBusy] = useState(false)

  // Load the workflow list once per location, then open the first one.
  useEffect(() => {
    if (!loc) return
    let active = true
    setStatus('loading')
    api
      .workflows(loc)
      .then((r) => {
        if (!active) return
        setWorkflows(r.workflows)
        setStatus(r.workflows.length > 0 ? 'ready' : 'empty')
        setSelectedId(r.workflows[0]?.id ?? null)
      })
      .catch(() => active && setStatus('empty'))
    return () => {
      active = false
    }
  }, [loc])

  // Load the selected workflow's steps whenever the selection changes.
  useEffect(() => {
    if (!loc || !selectedId) {
      setSteps([])
      setDirty(false)
      return
    }
    let active = true
    api
      .workflow(loc, selectedId)
      .then((r) => {
        if (!active) return
        setSteps(r.actions.map(toInput))
        setDirty(false)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc, selectedId])

  // Contacts power the test-run picker and the run cards' name lookup.
  useEffect(() => {
    if (!loc) return
    let active = true
    api
      .contacts(loc)
      .then((r) => active && setContacts(r.contacts))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [loc])

  // Execution history for the selected workflow.
  useEffect(() => {
    if (!loc || !selectedId) {
      setRuns([])
      return
    }
    let active = true
    setRunsLoading(true)
    api
      .workflowRuns(loc, selectedId)
      .then((r) => active && setRuns(r.runs))
      .catch(() => active && setRuns([]))
      .finally(() => active && setRunsLoading(false))
    return () => {
      active = false
    }
  }, [loc, selectedId])

  const selected = useMemo(
    () => workflows.find((w) => w.id === selectedId) ?? null,
    [workflows, selectedId],
  )

  const contactName = useCallback(
    (contactId: string | null): string => {
      if (!contactId) return 'No contact'
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return 'Unknown contact'
      return (
        c.name?.trim() || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Contact'
      )
    },
    [contacts],
  )

  async function testRun(contactId: string) {
    if (!loc || !selectedId) return
    setTestRunBusy(true)
    try {
      const r = await api.testRunWorkflow(loc, selectedId, contactId)
      setRuns((prev) => [r.run, ...prev]) // newest first, matches the server order
      setShowTestRun(false)
    } finally {
      setTestRunBusy(false)
    }
  }

  async function createWorkflow(input: NewWorkflow) {
    if (!loc) return
    const r = await api.createWorkflow(loc, input)
    setWorkflows((prev) => [r.workflow, ...prev])
    setSelectedId(r.workflow.id)
    setStatus('ready')
    setShowNew(false)
  }

  async function toggleStatus() {
    if (!loc || !selected) return
    const next: WorkflowStatus = selected.status === 'live' ? 'draft' : 'live'
    setWorkflows((prev) => prev.map((w) => (w.id === selected.id ? { ...w, status: next } : w)))
    try {
      await api.updateWorkflow(loc, selected.id, { status: next })
    } catch {
      // revert on failure
      setWorkflows((prev) =>
        prev.map((w) => (w.id === selected.id ? { ...w, status: selected.status } : w)),
      )
    }
  }

  function addStep(step: WorkflowActionInput) {
    setSteps((prev) => [...prev, step])
    setDirty(true)
    setShowAddStep(false)
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  async function saveSteps() {
    if (!loc || !selectedId) return
    setSavingSteps(true)
    try {
      const r = await api.replaceWorkflowActions(loc, selectedId, steps)
      setSteps(r.actions.map(toInput))
      setDirty(false)
    } finally {
      setSavingSteps(false)
    }
  }

  if (!loc) return <Empty message="Select a sub-account to view automations." />
  if (status === 'loading') return <PageSpinner />

  return (
    <div className="flex h-full min-h-0">
      {/* Workflow rail — master-detail: full-width list on mobile, w-72 sidebar on desktop */}
      <div
        className={cn(
          'flex-col border-r border-slate-200 bg-white lg:flex lg:w-72 lg:shrink-0',
          selected ? 'hidden' : 'flex w-full',
        )}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Workflows
          </p>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            title="New workflow"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <nav className="ol-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {workflows.map((w) => (
            <WorkflowRailRow
              key={w.id}
              workflow={w}
              active={w.id === selectedId}
              onClick={() => setSelectedId(w.id)}
            />
          ))}
          {workflows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-400">No workflows yet.</p>
          )}
        </nav>
      </div>

      {/* Builder + Runs Rail — shown when a workflow is selected */}
      {selected ? (
        <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
          {/* Builder column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
              {/* Mobile back button */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 lg:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
                All Workflows
              </button>
              <div className="min-w-0 w-full lg:w-auto">
                <h1 className="truncate text-lg font-semibold text-slate-900">{selected.name}</h1>
                <p className="text-xs text-slate-500">
                  {steps.length} {steps.length === 1 ? 'step' : 'steps'} ·{' '}
                  {triggerMeta(selected.trigger_type).label}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {dirty && (
                  <Button size="sm" variant="outline" onClick={saveSteps} disabled={savingSteps}>
                    {savingSteps ? 'Saving…' : 'Save steps'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowTestRun(true)}
                  disabled={steps.length === 0 || dirty}
                  title={
                    dirty
                      ? 'Save your steps before test-running'
                      : steps.length === 0
                        ? 'Add a step first'
                        : 'Run this workflow for a contact now'
                  }
                >
                  <Play className="h-4 w-4" />
                  Test run
                </Button>
                <StatusToggle status={selected.status} onToggle={toggleStatus} />
              </div>
            </header>

            <div className="ol-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-8 lg:px-6">
              <div className="mx-auto flex max-w-md flex-col items-stretch">
                {/* Trigger node */}
                <div className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Zap className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
                        Trigger
                      </p>
                      <p className="truncate text-sm font-medium text-slate-900">
                        {triggerMeta(selected.trigger_type).label}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Steps */}
                {steps.map((step, i) => {
                  const meta = actionMeta(step.type)
                  const Icon = meta.icon
                  return (
                    <div key={`${step.type}-${i}`} className="flex flex-col items-stretch">
                      <Connector />
                      <div className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                        <span
                          className={cn(
                            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                            meta.tile,
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{meta.label}</p>
                          <p className="truncate text-xs text-slate-500">
                            {actionSummary(step.type, step.config ?? {})}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          title="Remove step"
                          className="shrink-0 rounded-md p-1.5 text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Add step */}
                <Connector />
                <button
                  type="button"
                  onClick={() => setShowAddStep(true)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/60 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-brand-400 hover:bg-white hover:text-brand-600"
                >
                  <Plus className="h-4 w-4" />
                  Add step
                </button>
              </div>
            </div>
          </div>

          {/* Execution history — stacks below builder on mobile, right rail on desktop */}
          <RunsRail runs={runs} loading={runsLoading} contactName={contactName} />
        </div>
      ) : (
        <BuilderEmpty onNew={() => setShowNew(true)} />
      )}

      {showNew && (
        <NewWorkflowDialog onCancel={() => setShowNew(false)} onCreate={createWorkflow} />
      )}
      {showAddStep && (
        <AddStepDialog onCancel={() => setShowAddStep(false)} onAdd={addStep} />
      )}
      {showTestRun && selected && (
        <TestRunDialog
          contacts={contacts}
          workflowName={selected.name}
          busy={testRunBusy}
          onCancel={() => setShowTestRun(false)}
          onRun={testRun}
        />
      )}
    </div>
  )
}

function Connector() {
  return <div className="mx-auto h-6 w-0.5 bg-slate-200" />
}

function StatusToggle({ status, onToggle }: { status: string; onToggle: () => void }) {
  const live = status === 'live'
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2"
      title={live ? 'Set to draft' : 'Set live'}
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          live ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            live ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
      <span
        className={cn(
          'text-sm font-medium',
          live ? 'text-emerald-600' : 'text-slate-500',
        )}
      >
        {live ? 'Live' : 'Draft'}
      </span>
    </button>
  )
}

function WorkflowRailRow({
  workflow,
  active,
  onClick,
}: {
  workflow: Workflow
  active: boolean
  onClick: () => void
}) {
  const live = workflow.status === 'live'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
        active ? 'bg-brand-50' : 'hover:bg-slate-50',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500',
        )}
      >
        <WorkflowIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            active ? 'text-brand-900' : 'text-slate-800',
          )}
        >
          {workflow.name}
        </p>
        <p className="truncate text-[11px] text-slate-500">
          {triggerMeta(workflow.trigger_type).label}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          live ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
        )}
      >
        {live ? 'Live' : 'Draft'}
      </span>
    </button>
  )
}

function BuilderEmpty({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-slate-50 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <WorkflowIcon className="h-9 w-9 text-slate-300" />
        <div>
          <p className="text-sm font-medium text-slate-900">No workflow selected</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Create a workflow to start automating follow-ups.
          </p>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="h-4 w-4" />
          New workflow
        </Button>
      </div>
    </div>
  )
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-slate-400">{message}</p>
    </div>
  )
}
