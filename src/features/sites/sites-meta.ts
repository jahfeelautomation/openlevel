import { CheckCircle2, FileText, MousePointerClick, type LucideIcon } from 'lucide-react'
import type { FunnelStepType } from '../../lib/api'

export interface StepMeta {
  label: string
  icon: LucideIcon
  /** Tailwind classes for the little square tile behind the icon. */
  tile: string
}

const META: Record<FunnelStepType, StepMeta> = {
  opt_in: { label: 'Opt-in', icon: MousePointerClick, tile: 'bg-brand-50 text-brand-600' },
  thank_you: { label: 'Thank you', icon: CheckCircle2, tile: 'bg-emerald-50 text-emerald-600' },
  sales: { label: 'Sales page', icon: FileText, tile: 'bg-amber-50 text-amber-600' },
}

const FALLBACK: StepMeta = { label: 'Page', icon: FileText, tile: 'bg-slate-100 text-slate-500' }

export function stepMeta(type: string): StepMeta {
  return META[type as FunnelStepType] ?? FALLBACK
}

export const STEP_TYPE_OPTIONS: { value: FunnelStepType; label: string }[] = [
  { value: 'opt_in', label: 'Opt-in page' },
  { value: 'sales', label: 'Sales page' },
  { value: 'thank_you', label: 'Thank-you page' },
]

/** Turn a human field label into a stable snake_case field name + input type.
 *  `full_name`/`email`/`phone` are recognized so the capture route maps them
 *  onto the contact's identity. */
export function fieldFromLabel(label: string): { name: string; type: string } {
  const name = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const type = name.includes('email') ? 'email' : name.includes('phone') ? 'tel' : 'text'
  return { name: name || 'field', type }
}
