import { apiRequest } from './api'

export type PaymentAttemptStatus =
  | 'PENDING'
  | 'CAPTURING'
  | 'AMBIGUOUS'
  | 'DECLINED'
  | 'FAILED'
  | 'SUCCEEDED'
  | 'CANCELLED'

export interface PaymentPlanInvoice {
  id: string
  title: string
  counterparty: string
  amountMinor: number
  currency: string
  dueDate: string
  status: 'PENDING' | 'OVERDUE'
  updatedAt: string
}

export interface PaymentPlan {
  id: string
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'STALE' | 'CANCELLED'
  proposalVersion: string
  totalAmount: number
  currency: string
  expiresAt: string
  approvedAt: string | null
  invoices: PaymentPlanInvoice[]
  createdAt: string
}

export interface PaymentAttempt {
  id: string
  paymentPlanId: string | null
  paypalOrderId: string | null
  captureId: string | null
  amountMinor: number
  currency: string
  status: PaymentAttemptStatus
  providerStatus: string | null
  invoiceIds: string[]
  createdAt: string
  updatedAt: string
}

interface DataResponse<T> {
  data: T
}

interface PayPalConfiguration {
  environment: 'sandbox'
  configured: boolean
  clientId: string | null
}

export function getPayPalConfiguration() {
  return apiRequest<DataResponse<PayPalConfiguration>>('payments/config')
    .then(({ data }) => data)
}

export function createPaymentPlan(invoiceIds: string[]) {
  return apiRequest<DataResponse<PaymentPlan>>('payment-plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invoiceIds }),
  }).then(({ data }) => data)
}

export function approvePaymentPlan(plan: PaymentPlan) {
  return apiRequest<DataResponse<PaymentPlan>>(
    `payment-plans/${encodeURIComponent(plan.id)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        proposalVersion: plan.proposalVersion,
        totalAmount: plan.totalAmount,
        currency: plan.currency,
        confirm: true,
      }),
    },
  ).then(({ data }) => data)
}

export function createPayPalOrder(plan: PaymentPlan) {
  return apiRequest<DataResponse<PaymentAttempt>>(
    `payment-plans/${encodeURIComponent(plan.id)}/order`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalVersion: plan.proposalVersion }),
    },
  ).then(({ data }) => data)
}

export function capturePayPalOrder(attemptId: string, orderId: string) {
  return apiRequest<DataResponse<PaymentAttempt>>(
    `payments/attempts/${encodeURIComponent(attemptId)}/capture`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId }),
    },
  ).then(({ data }) => data)
}

export function getPaymentAttempt(attemptId: string) {
  return apiRequest<DataResponse<PaymentAttempt>>(
    `payments/attempts/${encodeURIComponent(attemptId)}`,
  ).then(({ data }) => data)
}

export function reconcilePayPalAttempt(attemptId: string) {
  return apiRequest<DataResponse<PaymentAttempt>>(
    `payments/attempts/${encodeURIComponent(attemptId)}/reconcile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  ).then(({ data }) => data)
}

export function cancelPayPalAttempt(attemptId: string) {
  return apiRequest<DataResponse<PaymentAttempt>>(
    `payments/attempts/${encodeURIComponent(attemptId)}/cancel`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  ).then(({ data }) => data)
}
