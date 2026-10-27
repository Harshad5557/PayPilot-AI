import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiRequestError } from './lib/api'
import type { AuthenticatedUser } from './lib/auth'

function messageFor(error: unknown) {
  if (error instanceof ApiRequestError) return error.message
  return 'The request could not be completed. Check the API server and try again.'
}

export function ProfileDialog({
  user,
  onClose,
  onSave,
}: {
  user: AuthenticatedUser
  onClose: () => void
  onSave: (input: { email: string; name: string }) => Promise<AuthenticatedUser>
}) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ name, email })
      onClose()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-heading"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="profile-heading" className="text-lg font-semibold text-slate-900">Manage profile</h2>
        <p className="mt-1 text-sm text-slate-500">Your name and email are saved to your account.</p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-slate-700">
            Full name
            <input
              autoComplete="name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3.5 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              autoComplete="email"
              required
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3.5 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button disabled={saving} className="rounded-xl bg-[#17233e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#243654] disabled:opacity-60">
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-heading"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 id="help-heading" className="text-lg font-semibold text-slate-900">Help & support</h2>
        <p className="mt-1 text-sm text-slate-500">Quick guidance for this PayPilot AI workspace.</p>
        <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
          <li><strong className="text-slate-800">Invoices:</strong> Use Add invoice to create an obligation; select pending or overdue items to prepare a plan.</li>
          <li><strong className="text-slate-800">Assistant:</strong> Ask about due dates and priorities. It cannot modify records or make payments.</li>
          <li><strong className="text-slate-800">Sandbox checkout:</strong> Review and explicitly approve a plan before opening PayPal Sandbox. Only backend-verified captures are marked successful.</li>
          <li><strong className="text-slate-800">Need setup help?</strong> Check the repository README for Windows commands, environment variables, and troubleshooting.</li>
        </ul>
        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="rounded-xl bg-[#17233e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#243654]">
            Close help
          </button>
        </div>
      </section>
    </div>
  )
}
