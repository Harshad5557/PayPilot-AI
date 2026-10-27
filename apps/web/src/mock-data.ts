export interface DemoActivity {
  id: string
  type: 'invoice' | 'reminder' | 'plan' | 'update'
  description: string
  subject: string
  time: string
}

export interface DemoChartPoint {
  label: string
  date: string
  amount: number
}

export const demoChart: DemoChartPoint[] = [
  { label: 'Sep 14', date: '2026-09-14', amount: 420000 },
  { label: 'Sep 21', date: '2026-09-21', amount: 610000 },
  { label: 'Sep 28', date: '2026-09-28', amount: 490000 },
  { label: 'Oct 05', date: '2026-10-05', amount: 790000 },
  { label: 'Oct 12', date: '2026-10-12', amount: 670000 },
  { label: 'Oct 19', date: '2026-10-19', amount: 930000 },
]

export const demoWelcomeDate = 'Friday, October 23, 2026'

export const demoActivity: DemoActivity[] = [
  {
    id: 'activity-1',
    type: 'invoice',
    description: 'Invoice record added to the demo workspace',
    subject: 'Fictional Design Tools Ltd.',
    time: 'Today, 9:42 AM',
  },
  {
    id: 'activity-2',
    type: 'reminder',
    description: 'Due-date reminder scheduled for review',
    subject: 'DEMO-2048 · Fictional Cloud Hosting Co.',
    time: 'Yesterday',
  },
  {
    id: 'activity-3',
    type: 'plan',
    description: 'A draft recommendation is ready to review',
    subject: 'Illustrative preview only',
    time: 'Oct 21, 2026',
  },
  {
    id: 'activity-4',
    type: 'update',
    description: 'Invoice details updated in the sample set',
    subject: 'DEMO-2045 · Fictional Harbour Workspace',
    time: 'Oct 20, 2026',
  },
]
