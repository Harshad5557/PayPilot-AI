import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiRequestError } from './lib/api'
import {
  loginAccount,
  registerAccount,
  type AuthenticatedUser,
} from './lib/auth'

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message
  return 'The account service is unavailable. Check the API server and try again.'
}

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthenticatedUser) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = mode === 'register'
        ? await registerAccount({ name, email, password })
        : await loginAccount({ email, password })
      onAuthenticated(user)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-teal-500 text-[#101b33]">
          <span className="text-lg font-bold">P</span>
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">PayPilot AI</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          {mode === 'register' ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Sign in to access your private invoice workspace. New accounts start with an empty workspace.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {mode === 'register' && (
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
          )}
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
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              type="password"
              minLength={mode === 'register' ? 12 : 1}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3.5 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
            />
            {mode === 'register' && (
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Use at least 12 characters.
              </span>
            )}
          </label>
          {error && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="h-11 w-full rounded-xl bg-[#17233e] px-4 text-sm font-semibold text-white hover:bg-[#243654] disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          {mode === 'register' ? 'Already registered?' : 'New to PayPilot AI?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode((current) => current === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="font-semibold text-teal-800 hover:text-teal-950"
          >
            {mode === 'register' ? 'Sign in' : 'Create account'}
          </button>
        </p>
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">
          PayPal Sandbox only. AI recommendations are read-only. Passwords are stored as salted hashes; browser sessions use HttpOnly cookies.
        </p>
      </section>
    </main>
  )
}
