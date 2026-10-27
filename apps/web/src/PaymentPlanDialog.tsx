import { useEffect, useState } from 'react'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import { ApiRequestError } from './lib/api'
import {
  approvePaymentPlan,
  cancelPayPalAttempt,
  capturePayPalOrder,
  createPayPalOrder,
  getPaymentAttempt,
  getPayPalConfiguration,
  reconcilePayPalAttempt,
  type PaymentAttempt,
  type PaymentPlan,
} from './lib/payments'

function formatCurrency(amountMinor: number, currency: string) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits)
}

function messageFor(error: unknown) {
  if (error instanceof ApiRequestError) return error.message
  return 'The payment service could not complete the request. Check the attempt status before retrying.'
}

export function PaymentPlanDialog({
  initialPlan,
  onClose,
  onRefresh,
}: {
  initialPlan: PaymentPlan
  onClose: () => void
  onRefresh: () => void
}) {
  const [plan, setPlan] = useState(initialPlan)
  const [configuration, setConfiguration] =
    useState<Awaited<ReturnType<typeof getPayPalConfiguration>> | null>(null)
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getPayPalConfiguration()
      .then((config) => {
        if (active) setConfiguration(config)
      })
      .catch((reason: unknown) => {
        if (active) setError(messageFor(reason))
      })
    return () => {
      active = false
    }
  }, [])

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      const updated = await approvePaymentPlan(plan)
      setPlan(updated)
      setNotice('Your exact plan amount is approved. Continue to PayPal Sandbox checkout.')
      setApproved(true)
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function createOrder() {
    setError(null)
    setBusy(true)
    try {
      const created = await createPayPalOrder(plan)
      setAttempt(created)
      if (!created.paypalOrderId) {
        throw new Error('PayPal did not return an order ID.')
      }
      return created.paypalOrderId
    } catch (reason) {
      setError(messageFor(reason))
      if (reason instanceof ApiRequestError && reason.meta?.paymentAttemptId) {
        try {
          setAttempt(await getPaymentAttempt(reason.meta.paymentAttemptId))
        } catch {
          setNotice('The order outcome is uncertain. The backend recorded an attempt; refresh before retrying.')
        }
      }
      throw reason
    } finally {
      setBusy(false)
    }
  }

  async function capture(orderId: string) {
    if (!attempt) {
      setError('The local payment attempt is missing. No success has been recorded.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice('PayPal approved the checkout. The backend is verifying the capture.')
    try {
      const result = await capturePayPalOrder(attempt.id, orderId)
      setAttempt(result)
      if (result.status === 'SUCCEEDED') {
        setNotice('Sandbox capture verified by the backend.')
        onRefresh()
      } else if (result.status === 'PENDING' || result.status === 'CAPTURING') {
        setNotice('Capture is still processing. Refresh the attempt status before taking further action.')
      } else {
        setNotice(`Backend payment status: ${result.status.toLowerCase()}.`)
      }
    } catch (reason) {
      setError(messageFor(reason))
      try {
        const latest = await getPaymentAttempt(attempt.id)
        setAttempt(latest)
        if (latest.status === 'SUCCEEDED') {
          setNotice('Sandbox capture verified by the backend.')
          onRefresh()
        } else {
          setNotice(`Backend payment status: ${latest.status.toLowerCase()}. No success is assumed.`)
        }
      } catch {
        setNotice('The capture result is uncertain. Check the backend payment attempt before retrying.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!attempt) {
      setNotice('Checkout was cancelled. No capture was requested.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const cancelled = await cancelPayPalAttempt(attempt.id)
      setAttempt(cancelled)
      setNotice('Checkout was cancelled. No payment success was recorded.')
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function refreshAttempt() {
    if (!attempt) return
    setBusy(true)
    setError(null)
    try {
      const latest = await getPaymentAttempt(attempt.id)
      setAttempt(latest)
      setNotice(`Backend payment status: ${latest.status.toLowerCase()}.`)
      if (latest.status === 'SUCCEEDED') onRefresh()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function reconcileAttempt() {
    if (!attempt) return
    setBusy(true)
    setError(null)
    try {
      const latest = await reconcilePayPalAttempt(attempt.id)
      setAttempt(latest)
      if (latest.status === 'SUCCEEDED') {
        setNotice('Sandbox capture verified by the backend.')
        onRefresh()
      } else {
        setNotice(`Provider status remains ${latest.status.toLowerCase()}. No success is assumed.`)
      }
    } catch (reason) {
      setError(messageFor(reason))
      setNotice('The payment remains unresolved. Do not retry checkout until the backend status is verified.')
    } finally {
      setBusy(false)
    }
  }

  async function closeDialog() {
    if (
      attempt?.status === 'CAPTURING' ||
      attempt?.status === 'AMBIGUOUS' ||
      (attempt?.status === 'PENDING' && attempt.providerStatus !== 'CREATED')
    ) {
      setError('The payment outcome may still be processing. Keep this panel open and refresh the attempt status before closing.')
      return
    }
    if (attempt?.status === 'PENDING') {
      setBusy(true)
      try {
        const cancelled = await cancelPayPalAttempt(attempt.id)
        setAttempt(cancelled)
        onClose()
      } catch (reason) {
        setError(messageFor(reason))
      } finally {
        setBusy(false)
      }
      return
    }
    onClose()
  }

  const checkoutAllowed =
    plan.status === 'APPROVED' &&
    configuration?.configured === true &&
    configuration.clientId !== null &&
    !['CAPTURING', 'SUCCEEDED', 'DECLINED', 'FAILED', 'CANCELLED'].includes(attempt?.status ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <section
        aria-labelledby="payment-plan-dialog-heading"
        aria-modal="true"
        className="my-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">
              Payment approval
            </p>
            <h2 id="payment-plan-dialog-heading" className="mt-1 text-xl font-semibold text-slate-900">
              Review exact plan
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Approval is required before the PayPal Sandbox button is enabled.
            </p>
          </div>
          <button
            aria-label="Close payment plan"
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
            disabled={busy}
            onClick={closeDialog}
          >
            Close
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-2xl bg-slate-50 p-5">
            <p className="text-xs font-medium text-slate-500">Backend-derived total</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
              {formatCurrency(plan.totalAmount, plan.currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {plan.currency} · plan version {plan.proposalVersion.slice(0, 12)} · expires{' '}
              {new Date(plan.expiresAt).toLocaleString()}
            </p>
          </div>

          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 px-4">
            {plan.invoices.map((invoice) => (
              <li className="flex items-start justify-between gap-4 py-3" key={invoice.id}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {invoice.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {invoice.counterparty} · {invoice.status.toLowerCase()}
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-800">
                  {formatCurrency(invoice.amountMinor, invoice.currency)}
                </span>
              </li>
            ))}
          </ul>

          {plan.status === 'PROPOSED' && (
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm leading-5 text-slate-700">
                <input
                  checked={approved}
                  className="mt-1 accent-teal-700"
                  onChange={(event) => setApproved(event.target.checked)}
                  type="checkbox"
                />
                I approve this exact plan total and currency.
              </label>
              <button
                className="w-full rounded-xl bg-[#17233e] px-4 py-3 text-sm font-semibold text-white hover:bg-[#243654] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!approved || busy}
                onClick={approve}
              >
                {busy ? 'Recording approval…' : 'Approve exact plan'}
              </button>
            </div>
          )}

          {plan.status === 'APPROVED' && !configuration?.configured && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900">
              PayPal Sandbox is not configured. Add sandbox client credentials to the backend environment;
              no checkout will be presented until the server is configured.
            </p>
          )}

          {checkoutAllowed && configuration?.clientId && (
            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-blue-950">PayPal Sandbox checkout</p>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-900">
                  Test environment
                </span>
              </div>
              <p className="text-xs leading-5 text-blue-900">
                This uses PayPal test accounts only. The backend creates the order and verifies any capture.
              </p>
              <PayPalScriptProvider options={{
                clientId: configuration.clientId,
                currency: plan.currency,
                intent: 'capture',
                components: 'buttons',
              }}>
                <PayPalButtons
                  disabled={busy}
                  forceReRender={[plan.totalAmount, plan.currency, plan.proposalVersion]}
                  style={{ layout: 'vertical', shape: 'rect', label: 'paypal' }}
                  createOrder={createOrder}
                  onApprove={async (data) => capture(data.orderID)}
                  onCancel={cancel}
                  onError={async () => {
                    if (attempt) {
                      try {
                        setAttempt(await getPaymentAttempt(attempt.id))
                      } catch {
                        setNotice('Checkout result is uncertain. Refresh the backend payment attempt before retrying.')
                      }
                    }
                    setError('PayPal checkout reported an error. No success is assumed; check the backend attempt status.')
                  }}
                />
              </PayPalScriptProvider>
            </div>
          )}

          {attempt && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <span className="text-xs text-slate-600">
                Backend attempt: <strong>{attempt.status}</strong>
                {attempt.paypalOrderId ? ` · Order ${attempt.paypalOrderId}` : ''}
              </span>
              <div className="flex flex-wrap gap-2">
                {(attempt.status === 'AMBIGUOUS' ||
                  (attempt.status === 'PENDING' && attempt.providerStatus !== 'CREATED') ||
                  attempt.status === 'CAPTURING') &&
                  attempt.paypalOrderId && (
                    <button
                      className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                      disabled={busy}
                      onClick={reconcileAttempt}
                    >
                      Check PayPal status
                    </button>
                  )}
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={refreshAttempt}
                >
                  Refresh status
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-800" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-5 text-teal-900" role="status">
              {notice}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
