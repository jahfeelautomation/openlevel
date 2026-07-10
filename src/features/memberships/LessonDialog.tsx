import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { Lesson } from '../../lib/api'

export interface LessonDraft {
  title: string
  content: string | null
  videoUrl: string | null
}

/**
 * Create or edit a single lesson. A lesson is just a title plus optional written
 * content and a video URL — the same fields the public player renders. Saving an
 * edit only sends what changed; the student's completion of this lesson is
 * untouched, so progress stays truthful.
 */
export function LessonDialog({
  lesson,
  onCancel,
  onSave,
}: {
  /** Editing an existing lesson, or undefined to create a new one. */
  lesson?: Lesson
  onCancel: () => void
  onSave: (draft: LessonDraft) => Promise<void>
}) {
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [content, setContent] = useState(lesson?.content ?? '')
  const [videoUrl, setVideoUrl] = useState(lesson?.video_url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = Boolean(lesson)
  const canSave = title.trim().length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title: title.trim(),
        content: content.trim() ? content.trim() : null,
        videoUrl: videoUrl.trim() ? videoUrl.trim() : null,
      })
    } catch {
      setError('Could not save the lesson. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {editing ? 'Edit lesson' : 'Add lesson'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Give it a title and the content your students will work through.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="lesson-title">Lesson title</Label>
            <Input
              id="lesson-title"
              value={title}
              autoFocus
              placeholder="e.g. Find motivated sellers"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
          </div>
          <div>
            <Label htmlFor="lesson-content">Content</Label>
            <Textarea
              id="lesson-content"
              value={content}
              rows={5}
              placeholder="What this lesson teaches. Plain text — shown on the student's course page."
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lesson-video">Video URL (optional)</Label>
            <Input
              id="lesson-video"
              value={videoUrl}
              placeholder="https://… a YouTube, Vimeo or Loom link"
              onChange={(e) => setVideoUrl(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add lesson'}
          </Button>
        </div>
      </div>
    </div>
  )
}
