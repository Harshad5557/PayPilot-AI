import { apiRequest } from './api'

export type InvoiceStatus = 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELLED'

export interface InvoiceRecord {
  id: string
  title: string
  counterparty: string
  amountMinor: number
  currency: string
  dueDate: string
  status: InvoiceStatus
  createdAt: string
  updatedAt: string
}

export interface InvoiceInput {
  title: string
  counterparty: string
  amountMinor: number
  currency: string
  dueDate: string
}

export interface InvoiceListResponse {
  data: InvoiceRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    outstandingByCurrency: Record<string, number>
    overdueByCurrency: Record<string, number>
    overdueCount: number
    upcomingByCurrency: Record<string, number>
    upcomingCount: number
    completedByCurrency: Record<string, number>
    completedCount: number
  }
}

interface InvoiceResponse {
  data: InvoiceRecord
}

export interface InvoiceListOptions {
  search?: string
  status?: InvoiceStatus
  sortBy?: 'dueDate' | 'amount' | 'createdAt' | 'title' | 'status'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
  signal?: AbortSignal
}

export function listInvoices({
  signal,
  ...options
}: InvoiceListOptions = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest<InvoiceListResponse>(`invoices${query}`, { signal })
}

export async function getInvoice(id: string) {
  const response = await apiRequest<InvoiceResponse>(
    `invoices/${encodeURIComponent(id)}`,
  )
  return response.data
}

export async function createInvoice(input: InvoiceInput) {
  const response = await apiRequest<InvoiceResponse>('invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

export async function updateInvoice(id: string, input: Partial<InvoiceInput>) {
  const response = await apiRequest<InvoiceResponse>(
    `invoices/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return response.data
}
