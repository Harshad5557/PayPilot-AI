import { apiRequest } from './api'

export interface AssistantMessageResponse {
  intent: string
  summary: string
  recommendations: {
    text: string
    invoiceIds: string[]
  }[]
  requiresClarification: boolean
  clarificationQuestion: string | null
  source: 'gemini' | 'fallback'
  notice?: string
}

export async function askAssistant(message: string) {
  const response = await apiRequest<{ data: AssistantMessageResponse }>(
    'assistant/message',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  )
  return response.data
}
