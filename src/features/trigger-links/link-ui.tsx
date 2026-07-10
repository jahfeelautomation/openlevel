import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'

/** Absolute hosted URL for a link's `/api/public/l/...` path — what a visitor
 *  actually opens, and what the copy button puts on the clipboard. */
export function hostedUrl(path: string): string {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

/** Copy-to-clipboard button with a brief confirm tick. */
export function CopyButton({
  text,
  label = 'Copy link',
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked (e.g. insecure context) — no-op; the URL is still shown */
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void copy()}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}
