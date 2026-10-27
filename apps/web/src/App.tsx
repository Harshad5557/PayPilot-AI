import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import {
  demoActivity,
  demoChart,
  demoWelcomeDate,
} from './mock-data'
import { AuthScreen } from './AuthScreen'
import { HelpDialog, ProfileDialog } from './AccountDialogs'
import { ApiRequestError } from './lib/api'
import {
  getAuthSession,
  logoutAccount,
  updateAccountProfile,
  type AuthenticatedUser,
  type AuthSessionResponse,
} from './lib/auth'
import {
  askAssistant,
  type AssistantMessageResponse,
} from './lib/assistant'
import {
  createInvoice,
  type InvoiceInput,
  type InvoiceListResponse,
  type InvoiceRecord,
  type InvoiceStatus,
  listInvoices,
  updateInvoice,
} from './lib/invoices'
import {
  createPaymentPlan,
  type PaymentPlan,
} from './lib/payments'
import { PaymentPlanDialog } from './PaymentPlanDialog'

type IconName =
  | 'activity'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'bell'
  | 'calendar'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'close'
  | 'credit-card'
  | 'dashboard'
  | 'file'
  | 'filter'
  | 'help'
  | 'inbox'
  | 'menu'
  | 'more'
  | 'plus'
  | 'search'
  | 'sparkles'
  | 'wallet'

type ActivityRange = '7 days' | '30 days' | '6 weeks'

const iconPaths: Record<IconName, ReactNode> = {
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  'arrow-down': <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  'arrow-left': <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  'arrow-up': <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  'chevron-down': <><path d="m6 9 6 6 6-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  'credit-card': <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h3" /></>,
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4" /><circle cx="8" cy="7" r="1" /><circle cx="15" cy="12" r="1" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01" /></>,
  inbox: <><path d="M4 4h16l2 11v5H2v-5L4 4Z" /><path d="M2 15h6l2 3h4l2-3h6" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  sparkles: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z" /></>,
  wallet: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M16 15h2" /><path d="M3 5l2-3h14" /></>,
}

function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  )
}

const navItems: { label: string; icon: IconName; section: string }[] = [
  { label: 'Overview', icon: 'dashboard', section: 'overview' },
  { label: 'Invoices', icon: 'file', section: 'invoices' },
  { label: 'Payments', icon: 'credit-card', section: 'upcoming' },
  { label: 'Insights', icon: 'activity', section: 'activity' },
]

function Sidebar({
  activeSection,
  mobileOpen,
  invoiceCount,
  user,
  authMode,
  onNavigate,
  onClose,
  onEditProfile,
  onSignOut,
  onHelp,
}: {
  activeSection: string
  mobileOpen: boolean
  invoiceCount: number
  user: AuthenticatedUser
  authMode: 'session' | 'demo'
  onNavigate: (section: string) => void
  onClose: () => void
  onEditProfile: () => void
  onSignOut: () => void
  onHelp: () => void
}) {
  const [profileOptionsOpen, setProfileOptionsOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col bg-[#101b33] text-slate-300 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-white/[0.08] px-6">
          <a
            className="flex items-center gap-3 text-white"
            href="#overview"
            onClick={() => onNavigate('overview')}
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-teal-400 text-[#101b33]">
              <Icon name="wallet" size={21} />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              PayPilot<span className="text-teal-300"> AI</span>
            </span>
          </a>
          <button
            aria-label="Close navigation menu"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="px-4 pt-7">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
            Workspace
          </p>
          <div className="relative">
            <button
              aria-label="Open workspace menu"
              aria-expanded={workspaceOpen}
              aria-controls="workspace-menu"
              onClick={() => {
                setWorkspaceOpen((open) => !open)
                setProfileOptionsOpen(false)
              }}
              className="mt-3 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3 text-left hover:bg-white/10"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-violet-400/15 text-sm font-semibold text-violet-200">
                {initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block whitespace-normal break-words text-sm font-medium text-white">
                  Personal workspace
                </span>
                <span className="mt-0.5 block whitespace-normal break-all text-xs text-slate-300">
                  {user.name}
                </span>
              </span>
              <Icon name="chevron-down" size={16} className="text-slate-300" />
            </button>
            {workspaceOpen && (
              <div
                id="workspace-menu"
                role="status"
                className="absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border border-white/10 bg-[#1b2944] p-3 text-xs leading-5 text-slate-300 shadow-xl"
              >
                <p className="font-semibold text-white">Your personal workspace</p>
                <p className="mt-1">Invoices are private to this account. Workspace switching is not available.</p>
              </div>
            )}
          </div>
        </div>

        <nav className="mt-8 px-4" aria-label="Dashboard sections">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
            Menu
          </p>
          <ul className="space-y-1.5">
            {navItems.map((item) => {
              const active = activeSection === item.section
              return (
                <li key={item.section}>
                  <a
                    aria-current={active ? 'page' : undefined}
                    href={`#${item.section}`}
                    onClick={() => onNavigate(item.section)}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-teal-300/10 text-teal-300'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      size={19}
                      className={active ? 'text-teal-300' : 'text-slate-300 group-hover:text-slate-300'}
                    />
                    {item.label}
                    {item.label === 'Invoices' && (
                      <span className="ml-auto rounded-md bg-white/[0.08] px-2 py-0.5 text-xs text-slate-300">
                        {invoiceCount}
                      </span>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mt-auto px-4 pb-5">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-400/15 text-violet-200">
              <Icon name="sparkles" size={17} />
            </span>
            <p className="mt-3 text-sm font-medium text-white">Pilot your workflow</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              AI suggestions stay yours to review and approve.
            </p>
            <button
              className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-teal-300 hover:text-teal-300"
              onClick={() => onNavigate('recommendation')}
            >
              Explore recommendations <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <button
            onClick={onHelp}
            className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white"
          >
            <Icon name="help" size={18} /> Help & support
          </button>
          <div className="relative mt-3 flex items-start gap-3 border-t border-white/[0.08] px-2 pt-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-200 to-violet-300 text-xs font-bold text-slate-900">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-normal break-words text-sm font-medium text-white">
                {user.name}
              </span>
              <span className="block whitespace-normal break-all text-xs text-slate-300">
                {user.email}
              </span>
            </span>
            <button
              aria-label="More profile options"
              aria-expanded={profileOptionsOpen}
              aria-controls="profile-options"
              onClick={() => setProfileOptionsOpen((open) => !open)}
              className="rounded-lg p-1 text-slate-300 hover:text-white"
            >
              <Icon name="more" size={18} />
            </button>
            {profileOptionsOpen && (
              <div
                id="profile-options"
                className="absolute bottom-full right-0 z-20 mb-2 w-56 rounded-xl border border-white/10 bg-[#1b2944] p-2 text-xs text-slate-300 shadow-xl"
              >
                <p className="break-all px-2 py-1 font-semibold text-white">{user.email}</p>
                <button
                  onClick={() => {
                    setProfileOptionsOpen(false)
                    onEditProfile()
                  }}
                  className="w-full rounded-lg px-2 py-2 text-left hover:bg-white/10"
                >
                  Manage profile
                </button>
                {authMode === 'session' ? (
                  <button
                    onClick={onSignOut}
                    className="w-full rounded-lg px-2 py-2 text-left text-rose-300 hover:bg-white/10"
                  >
                    Sign out
                  </button>
                ) : (
                  <p className="px-2 py-2 leading-5 text-amber-300">
                    Demo identity mode has no sign-in session. Disable it to use account sign-out.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

function Header({
  onMenu,
  query,
  onSearch,
  searchInputRef,
  activityRange,
  onActivityRangeChange,
  overdueCount,
  upcomingCount,
  onShowInvoices,
}: {
  onMenu: () => void
  query: string
  onSearch: (query: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  activityRange: ActivityRange
  onActivityRangeChange: (range: ActivityRange) => void
  overdueCount: number
  upcomingCount: number
  onShowInvoices: (status: InvoiceStatus) => void
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeOptions: ActivityRange[] = ['7 days', '30 days', '6 weeks']

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="flex h-[76px] items-center gap-4 px-4 sm:px-7 lg:px-10">
        <button
          aria-label="Open navigation menu"
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
          onClick={onMenu}
        >
          <Icon name="menu" />
        </button>
        <div className="relative max-w-[440px] flex-1">
          <label className="sr-only" htmlFor="global-search">
            Search invoices
          </label>
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            ref={searchInputRef}
            id="global-search"
            type="search"
            value={query}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search invoices, vendors..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-16 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-400/10"
          />
          <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500 sm:inline">
            Ctrl / ⌘ K
          </kbd>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 sm:inline-flex">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Demo data
          </span>
          <div className="relative">
            <button
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
              aria-controls="invoice-notifications"
              onClick={() => {
                setNotificationsOpen((open) => !open)
                setRangeOpen(false)
              }}
              className="button-icon relative"
            >
              <Icon name="bell" size={19} />
              {overdueCount + upcomingCount > 0 && (
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-violet-500" />
              )}
            </button>
            {notificationsOpen && (
              <section
                id="invoice-notifications"
                aria-label="Invoice notifications"
                className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
              >
                <h2 className="text-sm font-semibold text-slate-900">Invoice reminders</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Based on demo invoice records; this is not a live notification service.
                </p>
                <button
                  className="mt-3 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50"
                  onClick={() => {
                    setNotificationsOpen(false)
                    onShowInvoices('OVERDUE')
                  }}
                >
                  <span className="text-slate-700">Overdue invoices</span>
                  <span className="font-semibold text-rose-700">{overdueCount}</span>
                </button>
                <button
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50"
                  onClick={() => {
                    setNotificationsOpen(false)
                    onShowInvoices('PENDING')
                  }}
                >
                  <span className="text-slate-700">Pending invoices</span>
                  <span className="font-semibold text-amber-800">{upcomingCount}</span>
                </button>
              </section>
            )}
          </div>
          <div className="relative hidden sm:block">
            <button
              aria-label={`Activity date range: Last ${activityRange}`}
              aria-expanded={rangeOpen}
              aria-controls="activity-range-options"
              onClick={() => {
                setRangeOpen((open) => !open)
                setNotificationsOpen(false)
              }}
              className="button-secondary"
            >
              <Icon name="calendar" size={16} />
              <span>Last {activityRange}</span>
              <Icon name="chevron-down" size={15} />
            </button>
            {rangeOpen && (
              <div
                id="activity-range-options"
                role="group"
                aria-label="Financial activity date range"
                className="absolute right-0 top-full z-30 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
              >
                {rangeOptions.map((range) => (
                  <button
                    key={range}
                    aria-pressed={activityRange === range}
                    onClick={() => {
                      onActivityRangeChange(range)
                      setRangeOpen(false)
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      activityRange === range
                        ? 'bg-teal-50 font-semibold text-teal-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Last {range}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id?: string
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-800">
            {eyebrow}
          </p>
        )}
        <h2 id={id} className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

function MetricCard({
  title,
  value,
  detail,
  icon,
  tone,
}: {
  title: string
  value: string
  detail: string
  icon: IconName
  tone: 'teal' | 'rose' | 'violet' | 'blue'
}) {
  const tones = {
    teal: 'bg-teal-50 text-teal-800',
    rose: 'bg-rose-50 text-rose-700',
    violet: 'bg-violet-50 text-violet-800',
    blue: 'bg-blue-50 text-teal-800',
  }
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,0.07)] sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <span className={`flex size-9 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <p className="mt-5 break-words text-2xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  )
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const labels: Record<InvoiceStatus, string> = {
    PENDING: 'Pending',
    OVERDUE: 'Overdue',
    PAID: 'Paid',
    CANCELLED: 'Cancelled',
  }
  const appearance: Record<string, string> = {
    Pending: 'bg-amber-50 text-amber-800 ring-amber-200',
    Overdue: 'bg-rose-50 text-rose-700 ring-rose-200',
    Paid: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    Cancelled: 'bg-slate-100 text-slate-700 ring-slate-200',
  }
  const label = labels[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        appearance[label] ?? 'bg-slate-100 text-slate-700 ring-slate-200'
      }`}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  )
}

function formatInvoiceDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function DueDateIndicator({ invoice }: { invoice: InvoiceRecord }) {
  if (invoice.status === 'OVERDUE') {
    return <span className="mt-0.5 block text-xs font-medium text-rose-700">Past due</span>
  }
  if (invoice.status === 'PENDING') {
    return (
      <span className="mt-0.5 block text-xs font-medium text-amber-800">Upcoming</span>
    )
  }
  return null
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon name={query ? 'search' : 'inbox'} size={22} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">
        {query ? 'No matching invoices' : 'Nothing to show yet'}
      </h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        {query
          ? 'Try a different search term or clear your search.'
          : 'Invoices will appear here when they are added to your workspace.'}
      </p>
    </div>
  )
}

function InvoiceTable({
  invoices,
  query,
  statusFilter,
  sortBy,
  pagination,
  sortOrder,
  loading,
  error,
  onStatusFilter,
  onSortBy,
  onSortOrder,
  onPage,
  onRetry,
  onView,
  onEdit,
  selectedInvoiceIds,
  onToggleInvoice,
  onCreatePaymentPlan,
  creatingPaymentPlan,
  paymentPlanError,
}: {
  invoices: InvoiceRecord[]
  query: string
  statusFilter: InvoiceStatus | 'ALL'
  sortBy: 'dueDate' | 'amount' | 'createdAt' | 'title'
  pagination: InvoiceListResponse['pagination'] | null
  sortOrder: 'asc' | 'desc'
  loading: boolean
  error: string | null
  onStatusFilter: (status: InvoiceStatus | 'ALL') => void
  onSortBy: (sortBy: 'dueDate' | 'amount' | 'createdAt' | 'title') => void
  onSortOrder: () => void
  onPage: (page: number) => void
  onRetry: () => void
  onView: (invoice: InvoiceRecord) => void
  onEdit: (invoice: InvoiceRecord) => void
  selectedInvoiceIds: string[]
  onToggleInvoice: (invoice: InvoiceRecord) => void
  onCreatePaymentPlan: () => void
  creatingPaymentPlan: boolean
  paymentPlanError: string | null
}) {
  const totalPages = pagination?.totalPages ?? 0
  return (
    <section
      id="invoices"
      aria-labelledby="invoices-heading"
      className="scroll-mt-24 flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.025)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
        <div>
          <h2 id="invoices-heading" className="text-base font-semibold text-slate-900">
            Recent invoices
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Invoices in your private workspace
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className="button-primary"
            disabled={selectedInvoiceIds.length === 0 || creatingPaymentPlan}
            onClick={onCreatePaymentPlan}
          >
            <Icon name="plus" size={16} />
            <span className="ml-2">
              {creatingPaymentPlan
                ? 'Preparing plan…'
                : selectedInvoiceIds.length
                  ? `Create payment plan (${selectedInvoiceIds.length})`
                  : 'Select invoices to plan'}
            </span>
          </button>
          <label className="sr-only" htmlFor="invoice-status-filter">Filter invoices by status</label>
          <select
            id="invoice-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value as InvoiceStatus | 'ALL')}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="OVERDUE">Overdue</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <label className="sr-only" htmlFor="invoice-sort">Sort invoices</label>
          <select
            id="invoice-sort"
            value={sortBy}
            onChange={(event) => onSortBy(event.target.value as typeof sortBy)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          >
            <option value="dueDate">Sort: due date</option>
            <option value="createdAt">Sort: newest</option>
            <option value="amount">Sort: amount</option>
            <option value="title">Sort: name</option>
          </select>
          <button
            aria-label={`Sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}
            title={`Sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}
            onClick={onSortOrder}
            className="button-icon border border-slate-200"
          >
            <Icon name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={15} />
          </button>
        </div>
        {paymentPlanError && (
          <p className="border-b border-rose-100 bg-rose-50 px-5 py-2.5 text-xs text-rose-700" role="alert">
            {paymentPlanError}
          </p>
        )}
      </div>
      {loading ? (
        <div className="flex-1 space-y-3 p-5" role="status" aria-label="Loading invoices">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
          <span className="sr-only">Loading invoices…</span>
        </div>
      ) : error ? (
        <div className="flex-1 px-5 py-10 text-center" role="alert">
          <p className="text-sm font-semibold text-slate-900">Invoices couldn’t be loaded</p>
          <p className="mt-1 text-xs text-slate-500">{error}</p>
          <button onClick={onRetry} className="button-quiet mt-3">
            Try again
          </button>
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed text-left">
              <thead>
                <tr className="bg-slate-50/80 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">
                  <th className="w-[38%] px-4 py-3.5 sm:px-6">Invoice</th>
                  <th className="hidden w-[18%] px-4 py-3.5 sm:table-cell">Due date</th>
                  <th className="w-[18%] px-4 py-3.5">Amount</th>
                  <th className="w-[18%] px-4 py-3.5">Status</th>
                  <th className="hidden w-[8%] px-4 py-3.5 md:table-cell"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="align-top transition-colors hover:bg-slate-50/70">
                    <td className="w-[38%] px-4 py-5 sm:px-6">
                      <div className="flex items-center gap-3">
                        <input
                          aria-label={`Select ${invoice.title} for a payment plan`}
                          checked={selectedInvoiceIds.includes(invoice.id)}
                          className="size-4 shrink-0 accent-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={invoice.status !== 'PENDING' && invoice.status !== 'OVERDUE'}
                          onChange={() => onToggleInvoice(invoice)}
                          title={
                            invoice.status === 'PAID' || invoice.status === 'CANCELLED'
                              ? `${invoice.status.toLowerCase()} invoices cannot be planned`
                              : 'Select invoice for a payment plan'
                          }
                          type="checkbox"
                        />
                        <span className="min-w-0 flex-1">
                          <button
                            onClick={() => onView(invoice)}
                            className="block max-w-full whitespace-normal break-words text-left text-sm font-semibold leading-6 text-slate-900 hover:text-teal-800"
                          >
                            {invoice.title}
                          </button>
                          <span className="mt-1 block whitespace-normal break-words text-xs leading-5 text-slate-500">
                            {invoice.counterparty}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="hidden w-[18%] px-4 py-5 text-sm text-slate-700 sm:table-cell">
                      <span className="block whitespace-nowrap">{formatInvoiceDate(invoice.dueDate)}</span>
                      <DueDateIndicator invoice={invoice} />
                    </td>
                    <td className="w-[18%] px-4 py-5 text-sm font-semibold tabular-nums text-slate-900">
                      {formatCurrency(invoice.amountMinor, invoice.currency)}
                    </td>
                    <td className="w-[18%] px-4 py-5"><StatusBadge status={invoice.status} /></td>
                    <td className="hidden w-[8%] px-4 py-5 md:table-cell">
                      <button
                        aria-label={`Edit ${invoice.title}`}
                        disabled={invoice.status === 'PAID' || invoice.status === 'CANCELLED'}
                        onClick={() => onEdit(invoice)}
                        className="button-secondary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-6">
            <p className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-700">{invoices.length}</span> of{' '}
              <span className="font-semibold text-slate-700">{pagination?.total ?? 0}</span> invoices
            </p>
            {totalPages > 1 && (
              <div className="mt-auto flex items-center gap-2">
                <button
                  disabled={!pagination || pagination.page <= 1}
                  onClick={() => onPage((pagination?.page ?? 1) - 1)}
                  className="button-secondary"
                >
                  Previous
                </button>
                <span className="text-xs tabular-nums text-slate-500">
                  {pagination?.page} / {totalPages}
                </span>
                <button
                  disabled={!pagination || pagination.page >= totalPages}
                  onClick={() => onPage((pagination?.page ?? 1) + 1)}
                  className="button-secondary"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function UpcomingPayments({
  invoices,
  error,
  onViewPending,
}: {
  invoices: InvoiceRecord[]
  error: string | null
  onViewPending: () => void
}) {
  const payments = invoices
    .filter((invoice) => invoice.status === 'PENDING')
    .sort((first, second) => first.dueDate.localeCompare(second.dueDate))
    .slice(0, 3)
  return (
    <section
      id="upcoming"
      aria-labelledby="upcoming-heading"
      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] sm:p-6"
    >
      <SectionHeading
        id="upcoming-heading"
        title="Upcoming payments"
        description="The next items on your calendar"
        action={
          <button
            onClick={onViewPending}
            className="text-xs font-semibold text-teal-800 hover:text-teal-800"
          >
            View pending invoices
          </button>
        }
      />
      <ul className="mt-5 divide-y divide-slate-100">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
            <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-slate-50 text-xs font-semibold uppercase leading-tight text-slate-500">
              {new Date(payment.dueDate).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
              <span className="mt-0.5 text-sm font-bold text-slate-900">
                {new Date(payment.dueDate).toLocaleDateString('en-US', { day: '2-digit', timeZone: 'UTC' })}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-normal break-words text-sm font-semibold text-slate-900">
                {payment.counterparty}
              </span>
              <span className="mt-0.5 block whitespace-normal break-words text-xs text-slate-500">
                {payment.title}
              </span>
            </span>
            <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
              {formatCurrency(payment.amountMinor, payment.currency)}
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-3.5 py-3 text-xs text-rose-700">
          Upcoming invoices could not be loaded: {error}
        </p>
      ) : payments.length === 0 && (
        <p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">
          No pending invoices are currently listed.
        </p>
      )}
    </section>
  )
}

function ActivityChart({ range }: { range: ActivityRange }) {
  const rangeDays: Record<ActivityRange, number> = {
    '7 days': 7,
    '30 days': 30,
    '6 weeks': 42,
  }
  const rangeStart = new Date('2026-10-23T00:00:00.000Z')
  rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeDays[range] + 1)
  const chartData = demoChart.filter((point) => point.date >= rangeStart.toISOString().slice(0, 10))
  const width = 620
  const height = 210
  const top = 15
  const bottom = 174
  const max = Math.max(...chartData.map((point) => point.amount))
  const points = chartData.map((point, index) => {
    const x = chartData.length === 1
      ? width / 2
      : (index / (chartData.length - 1)) * (width - 24) + 12
    const y = bottom - (point.amount / max) * (bottom - top)
    return { ...point, x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `12,${bottom} ${line} ${width - 12},${bottom}`
  const chartTotalMinor = chartData.reduce((total, point) => total + point.amount, 0)

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Financial activity</h2>
          <p className="mt-1 text-xs text-slate-500">
            Invoice value by week · fictional data
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-800">
          <Icon name="activity" size={14} /> Last {range}
        </span>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-end justify-between">
          <p className="text-2xl font-semibold tracking-tight text-slate-900">
            {formatCurrency(chartTotalMinor, 'USD')}
          </p>
          <span className="text-xs text-slate-500">USD · mock data</span>
        </div>
        <div className="overflow-hidden">
          <svg
            aria-labelledby="chart-title chart-description"
            className="h-[185px] w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
          >
            <title id="chart-title">Fictional invoice activity over six weeks</title>
            <desc id="chart-description">
              A line chart showing mock invoice values from {chartData[0]?.label} through {chartData.at(-1)?.label}.
            </desc>
            <defs>
              <linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#14b8a6" stopOpacity=".2" />
                <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[top, (top + bottom) / 2, bottom].map((y) => (
              <line
                key={y}
                x1="12"
                x2={width - 12}
                y1={y}
                y2={y}
                stroke="#e9eef3"
                strokeDasharray="4 5"
              />
            ))}
            <polygon points={area} fill="url(#activity-fill)" />
            <polyline
              points={line}
              fill="none"
              stroke="#0f9f92"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {points.map((point) => (
              <circle
                key={point.label}
                cx={point.x}
                cy={point.y}
                r="4"
                fill="white"
                stroke="#0f9f92"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="flex justify-between px-1 text-xs font-medium text-slate-500">
            {chartData.map((point) => <span key={point.label}>{point.label}</span>)}
          </div>
        </div>
      </div>
    </section>
  )
}

function RecentActivity() {
  const icons: Record<string, IconName> = {
    invoice: 'file',
    reminder: 'bell',
    plan: 'sparkles',
    update: 'check',
  }
  return (
    <section
      id="activity"
      aria-labelledby="activity-heading"
      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] sm:p-6"
    >
      <SectionHeading
        id="activity-heading"
        title="Recent activity"
        description="Updates from your demo workspace"
        action={
          <button
            onClick={exportDemoActivity}
            className="button-secondary"
          >
            Export CSV
          </button>
        }
      />
      <ol className="mt-5 space-y-4">
        {demoActivity.map((item, index) => (
          <li key={item.id} className="relative flex gap-3">
            {index < demoActivity.length - 1 && (
              <span className="absolute bottom-[-16px] left-[17px] top-9 w-px bg-slate-100" />
            )}
            <span className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl ${
              item.type === 'plan'
                ? 'bg-violet-50 text-violet-800'
                : item.type === 'reminder'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
            }`}>
              <Icon name={icons[item.type]} size={16} />
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="block text-sm font-medium leading-5 text-slate-900">
                {item.description}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {item.subject} · {item.time}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function exportDemoActivity() {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const rows = [
    ['Time', 'Activity', 'Subject'],
    ...demoActivity.map((item) => [item.time, item.description, item.subject]),
  ]
  const blob = new Blob(
    [rows.map((row) => row.map(quote).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  )
  const url = URL.createObjectURL(blob)
  const download = document.createElement('a')
  download.href = url
  download.download = 'paypilot-demo-activity.csv'
  download.click()
  URL.revokeObjectURL(url)
}

function RecommendationCard({
  overdueCount,
  message,
  response,
  loading,
  error,
  questionRef,
  onMessageChange,
  onSubmit,
}: {
  overdueCount: number
  message: string
  response: AssistantMessageResponse | null
  loading: boolean
  error: string | null
  questionRef: RefObject<HTMLTextAreaElement | null>
  onMessageChange: (message: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section
      id="recommendation"
      aria-labelledby="recommendation-heading"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-[#f6f4ff] via-white to-teal-50/70 p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] sm:p-6"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-violet-100/80 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] text-violet-800">
          <Icon name="sparkles" size={13} /> AI pilot
        </span>
        <span className="rounded-full border border-violet-200 bg-white/70 px-2.5 py-1 text-xs font-medium text-violet-800">
          Invoice assistant
        </span>
      </div>
      <h2 id="recommendation-heading" className="mt-4 text-lg font-semibold tracking-tight text-slate-900">
        Ask about your invoices
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        Ask about due dates, outstanding invoices, or which records may need review.
      </p>
      <form className="mt-4" onSubmit={onSubmit}>
        <label htmlFor="assistant-question" className="sr-only">
          Ask PayPilot AI about your invoices
        </label>
        <textarea
          ref={questionRef}
          id="assistant-question"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="e.g. Which invoices are due soon?"
          className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {overdueCount} overdue record{overdueCount === 1 ? '' : 's'} in this demo workspace
          </span>
          <button
            type="submit"
            disabled={loading || !message.trim()}
            className="button-primary shrink-0"
          >
            <Icon name="sparkles" size={14} />
            {loading ? 'Thinking…' : 'Ask assistant'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-700">
          {error}
        </p>
      )}
      {response && (
        <div className="mt-4 rounded-xl border border-violet-100 bg-white/80 p-3.5" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-violet-800">
              {response.source === 'gemini' ? 'Gemini response' : 'Limited fallback'}
            </span>
            {response.notice && (
              <span className="text-xs text-slate-500">{response.notice.replaceAll('_', ' ').toLowerCase()}</span>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{response.summary}</p>
          {response.recommendations.length > 0 && (
            <ul className="mt-3 space-y-2">
              {response.recommendations.map((recommendation, index) => (
                <li key={`${index}-${recommendation.invoiceIds.join(',')}`} className="text-xs leading-5 text-slate-700">
                  <span>{recommendation.text}</span>
                  {recommendation.invoiceIds.length > 0 && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Invoice IDs: {recommendation.invoiceIds.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {response.requiresClarification && response.clarificationQuestion && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs font-medium text-slate-700">
              {response.clarificationQuestion}
            </p>
          )}
        </div>
      )}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-violet-100 bg-white/75 p-3">
        <Icon name="help" size={16} className="mt-0.5 shrink-0 text-violet-800" />
        <p className="text-xs leading-5 text-slate-700">
          Read-only guidance from demo invoice records. No payment is initiated, approved, or verified.
        </p>
      </div>
    </section>
  )
}

function InvoiceFormDialog({
  invoice,
  error,
  saving,
  onClose,
  onSave,
}: {
  invoice?: InvoiceRecord
  error: string | null
  saving: boolean
  onClose: () => void
  onSave: (input: InvoiceInput) => Promise<void>
}) {
  const [title, setTitle] = useState(invoice?.title.replace(/^DEMO\s*[·-]\s*/, '') ?? '')
  const [counterparty, setCounterparty] = useState(invoice?.counterparty ?? '')
  const invoiceDigits = invoice ? currencyFractionDigits(invoice.currency) : 2
  const [amount, setAmount] = useState(
    invoice
      ? (invoice.amountMinor / 10 ** invoiceDigits).toFixed(invoiceDigits)
      : '',
  )
  const [currency, setCurrency] = useState(invoice?.currency ?? 'USD')
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate.slice(0, 10) ?? '',
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeButtonRef.current?.focus(), [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fractionDigits = currencyFractionDigits(currency)
    const pattern = fractionDigits === 0
      ? /^(\d+)$/
      : new RegExp(`^(\\d+)(?:\\.(\\d{1,${fractionDigits}}))?$`)
    const match = pattern.exec(amount.trim())
    if (!match) {
      setValidationError(
        `Enter a valid ${currency} amount with up to ${fractionDigits} decimal places.`,
      )
      return
    }
    const amountMinor =
      Number(match[1]) * 10 ** fractionDigits +
      Number((match[2] ?? '').padEnd(fractionDigits, '0'))
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 2_147_483_647) {
      setValidationError(`Amount must be positive and within the supported ${currency} range.`)
      return
    }
    setValidationError(null)
    await onSave({ title, counterparty, amountMinor, currency, dueDate })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45" role="presentation">
      <button className="absolute inset-0 cursor-default" aria-label="Close invoice form" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-form-heading"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
              {invoice ? 'Update record' : 'New record'}
            </p>
            <h2 id="invoice-form-heading" className="mt-1 text-xl font-semibold text-slate-900">
              {invoice ? 'Edit invoice' : 'Create invoice'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Development demo workspace · no payment will be initiated
            </p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Close invoice form"
            onClick={onClose}
            className="button-icon"
          >
            <Icon name="close" size={19} />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-5 px-6 py-6">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Invoice title</span>
              <input
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
                placeholder="e.g. Cloud hosting · November"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Counterparty</span>
              <input
                required
                maxLength={160}
                value={counterparty}
                onChange={(event) => setCounterparty(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
                placeholder="Supplier or vendor name"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Amount</span>
                <span className="relative block">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">{currency}</span>
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 pl-12 pr-3.5 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
                    placeholder="0.00"
                  />
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Enter in {currency}; stored as integer minor units.
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Currency</span>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  aria-label="Currency"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
                >
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CAD">CAD</option>
                  <option value="AUD">AUD</option>
                  <option value="JPY">JPY</option>
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  INR is supported for invoice records; PayPal Sandbox checkout depends on provider currency support.
                </span>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Due date</span>
              <input
                required
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10"
              />
            </label>
            {(validationError || error) && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
                {validationError ?? error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={onClose} className="button-secondary">
              Cancel
            </button>
            <button
              disabled={saving}
              type="submit"
              className="button-primary"
            >
              {saving ? 'Saving…' : invoice ? 'Save changes' : 'Create invoice'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function InvoiceDetailsDialog({
  invoice,
  onClose,
  onEdit,
}: {
  invoice: InvoiceRecord
  onClose: () => void
  onEdit: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeButtonRef.current?.focus(), [])
  const editable = invoice.status !== 'PAID' && invoice.status !== 'CANCELLED'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45" role="presentation">
      <button className="absolute inset-0 cursor-default" aria-label="Close invoice details" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-details-heading"
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
              Invoice details
            </p>
            <h2 id="invoice-details-heading" className="mt-1 text-xl font-semibold text-slate-900">
              {invoice.title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{invoice.id}</p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Close invoice details"
            onClick={onClose}
            className="button-icon"
          >
            <Icon name="close" size={19} />
          </button>
        </div>
        <div className="space-y-5 px-6 py-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">Record status</span>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="rounded-2xl bg-slate-50 p-5">
            <p className="text-xs font-medium text-slate-500">Invoice amount</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
              {formatCurrency(invoice.amountMinor, invoice.currency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">{invoice.currency} · minor-unit amount stored</p>
          </div>
          <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-100 px-4">
            <div className="flex justify-between gap-3 py-3.5">
              <dt className="text-sm text-slate-500">Counterparty</dt>
              <dd className="text-right text-sm font-medium text-slate-900">{invoice.counterparty}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3.5">
              <dt className="text-sm text-slate-500">Due date</dt>
              <dd className="text-right text-sm font-medium text-slate-900">{formatInvoiceDate(invoice.dueDate)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3.5">
              <dt className="text-sm text-slate-500">Created</dt>
              <dd className="text-right text-sm font-medium text-slate-900">{formatInvoiceDate(invoice.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-3.5">
              <dt className="text-sm text-slate-500">Last updated</dt>
              <dd className="text-right text-sm font-medium text-slate-900">{formatInvoiceDate(invoice.updatedAt)}</dd>
            </div>
          </dl>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-800">
            Development demo record. Its status is not proof of a verified transaction.
          </p>
        </div>
        <div className="mt-auto flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
          {editable && (
            <button onClick={onEdit} className="button-primary">
              Edit invoice
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function formatCurrency(minorUnits: number, currency: string) {
  const fractionDigits = currencyFractionDigits(currency)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(minorUnits / 10 ** fractionDigits)
}

function currencyFractionDigits(currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2
}

function formatCurrencyTotals(amounts: Record<string, number> | undefined) {
  const entries = Object.entries(amounts ?? {}).filter(([, amount]) => amount > 0)
  if (entries.length === 0) return formatCurrency(0, 'USD')
  return entries
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ')
}

function Dashboard({
  user,
  authMode,
  onProfileUpdated,
  onSignedOut,
}: {
  user: AuthenticatedUser
  authMode: 'session' | 'demo'
  onProfileUpdated: (user: AuthenticatedUser) => void
  onSignedOut: () => void
}) {
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activityRange, setActivityRange] = useState<ActivityRange>('30 days')
  const [activeSection, setActiveSection] = useState('overview')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'ALL'>('ALL')
  const [sortBy, setSortBy] = useState<'dueDate' | 'amount' | 'createdAt' | 'title'>('dueDate')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [invoiceResult, setInvoiceResult] = useState<InvoiceListResponse | null>(null)
  const [upcomingInvoices, setUpcomingInvoices] = useState<InvoiceRecord[]>([])
  const [invoiceState, setInvoiceState] = useState<'loading' | 'success' | 'error'>('loading')
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dialog, setDialog] = useState<
    | { type: 'details'; invoice: InvoiceRecord }
    | { type: 'form'; invoice?: InvoiceRecord }
    | null
  >(null)
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [upcomingError, setUpcomingError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantResponse, setAssistantResponse] =
    useState<AssistantMessageResponse | null>(null)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([])
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan | null>(null)
  const [creatingPaymentPlan, setCreatingPaymentPlan] = useState(false)
  const [paymentPlanError, setPaymentPlanError] = useState<string | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [helpDialogOpen, setHelpDialogOpen] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const assistantQuestionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    listInvoices({
      search: query || undefined,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      sortBy,
      sortOrder,
      page,
      pageSize: 5,
      signal: controller.signal,
    })
      .then((result) => {
        setInvoiceResult(result)
        setInvoiceState('success')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setInvoiceError(errorMessage(error))
        setInvoiceState('error')
      })
    return () => {
      controller.abort()
    }
  }, [page, query, refreshKey, sortBy, sortOrder, statusFilter])

  useEffect(() => {
    const controller = new AbortController()
    listInvoices({
      status: 'PENDING',
      sortBy: 'dueDate',
      sortOrder: 'asc',
      pageSize: 3,
      signal: controller.signal,
    })
      .then((result) => {
        setUpcomingInvoices(result.data)
        setUpcomingError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setUpcomingError(errorMessage(error))
      })
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false)
      if (event.key === 'Escape') setDialog(null)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  function navigateTo(section: string) {
    setActiveSection(section)
    setMobileOpen(false)
    if (section !== 'overview') {
      document.getElementById(section)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
        block: 'start',
      })
    }
    if (section === 'recommendation') {
      assistantQuestionRef.current?.focus({ preventScroll: true })
    }
  }

  function showInvoicesWithStatus(status: InvoiceStatus) {
    if (statusFilter !== status || page !== 1) setInvoiceState('loading')
    setStatusFilter(status)
    setPage(1)
    navigateTo('invoices')
  }

  function errorMessage(error: unknown) {
    if (error instanceof ApiRequestError) {
      if (error.details?.length) {
        return error.details.map((detail) => `${detail.path}: ${detail.message}`).join(' ')
      }
      return error.message
    }
    return 'Check the API server and try again.'
  }

  async function saveInvoice(input: InvoiceInput) {
    setSavingInvoice(true)
    setFormError(null)
    try {
      if (dialog?.type === 'form' && dialog.invoice) {
        await updateInvoice(dialog.invoice.id, input)
        setNotice('Invoice record updated.')
      } else {
        await createInvoice(input)
        setNotice('Invoice record created.')
      }

      setDialog(null)
      setPage(1)
      setInvoiceState('loading')
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSavingInvoice(false)
    }
  }

  async function submitAssistantQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAssistantLoading(true)
    setAssistantError(null)
    setAssistantResponse(null)
    try {
      setAssistantResponse(await askAssistant(assistantQuestion.trim()))
    } catch (error) {
      setAssistantError(errorMessage(error))
    } finally {
      setAssistantLoading(false)
    }
  }

  async function startPaymentPlan() {
    if (selectedInvoiceIds.length === 0) return
    setCreatingPaymentPlan(true)
    setPaymentPlanError(null)
    try {
      const plan = await createPaymentPlan(selectedInvoiceIds)
      setPaymentPlan(plan)
      setSelectedInvoiceIds([])
    } catch (error) {
      setPaymentPlanError(errorMessage(error))
    } finally {
      setCreatingPaymentPlan(false)
    }
  }

  function toggleInvoiceSelection(invoice: InvoiceRecord) {
    setSelectedInvoiceIds((selected) =>
      selected.includes(invoice.id)
        ? selected.filter((id) => id !== invoice.id)
        : [...selected, invoice.id],
    )
    setPaymentPlanError(null)
  }

  function openForm(invoice?: InvoiceRecord) {
    setFormError(null)
    setNotice(null)
    setDialog({ type: 'form', ...(invoice ? { invoice } : {}) })
  }

  async function saveProfile(input: { email: string; name: string }) {
    const updated = await updateAccountProfile(input)
    onProfileUpdated(updated)
    return updated
  }

  async function signOut() {
    setAccountError(null)
    try {
      await logoutAccount()
      onSignedOut()
    } catch (error) {
      setAccountError(errorMessage(error))
    }
  }

  const summary = invoiceResult?.summary
  const invoiceCount = invoiceResult?.pagination.total ?? 0
  const identityLabel = authMode === 'demo'
    ? 'Development demo identity'
    : 'Authenticated account'

  function onSearch(value: string) {
    setInvoiceState('loading')
    setQuery(value)
    setPage(1)
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-[#f5f7fa] text-slate-900">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-white px-4 py-3 font-semibold text-slate-900 shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen">
        <Sidebar
          activeSection={activeSection}
          mobileOpen={mobileOpen}
          invoiceCount={invoiceCount}
          user={user}
          authMode={authMode}
          onNavigate={navigateTo}
          onClose={() => setMobileOpen(false)}
          onEditProfile={() => setProfileDialogOpen(true)}
          onSignOut={() => void signOut()}
          onHelp={() => setHelpDialogOpen(true)}
        />
        <div className="min-w-0 flex-1">
          <Header
            onMenu={() => setMobileOpen(true)}
            query={query}
            onSearch={onSearch}
            searchInputRef={searchInputRef}
            activityRange={activityRange}
            onActivityRangeChange={setActivityRange}
            overdueCount={summary?.overdueCount ?? 0}
            upcomingCount={summary?.upcomingCount ?? 0}
            onShowInvoices={showInvoicesWithStatus}
          />
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pb-10 pt-7 outline-none sm:px-7 sm:pt-9 lg:px-10">
            <div className="mx-auto max-w-[1280px]">
                  <section id="overview" className="scroll-mt-24">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-500">
                          {demoWelcomeDate}
                        </p>
                        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                          Welcome, {user.name.split(/\s+/)[0]} <span aria-hidden="true">✦</span>
                        </h1>
                        <p className="mt-2 text-sm text-slate-500">
                          Here’s what’s happening with your payment operations.
                        </p>
                      </div>
                      <button onClick={() => openForm()} className="button-primary">
                        <Icon name="plus" size={17} />
                        Add invoice
                      </button>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-800">
                      <span className="flex size-5 items-center justify-center rounded-full bg-amber-100">
                        <Icon name="help" size={13} />
                      </span>
                      <span className="font-semibold">{identityLabel}.</span>
                      Invoice data is loaded from the local demo database; it is not live account information or verified transactions.
                    </div>
                    {notice && (
                      <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                        {notice}
                      </p>
                    )}
                  </section>

                  <section aria-label="Payment summary" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard
                      title="Outstanding"
                      value={summary ? formatCurrencyTotals(summary.outstandingByCurrency) : '—'}
                      detail="Pending and overdue invoice records"
                      icon="wallet"
                      tone="teal"
                    />
                    <MetricCard
                      title="Overdue"
                      value={summary ? formatCurrencyTotals(summary.overdueByCurrency) : '—'}
                      detail={`${summary?.overdueCount ?? '—'} invoice records`}
                      icon="clock"
                      tone="rose"
                    />
                    <MetricCard
                      title="Upcoming"
                      value={summary ? formatCurrencyTotals(summary.upcomingByCurrency) : '—'}
                      detail={`${summary?.upcomingCount ?? '—'} pending invoice records`}
                      icon="calendar"
                      tone="violet"
                    />
                    <MetricCard
                      title="Paid status"
                      value={summary ? formatCurrencyTotals(summary.completedByCurrency) : '—'}
                      detail={`${summary?.completedCount ?? '—'} demo records · not verified`}
                      icon="check"
                      tone="blue"
                    />
                  </section>

                  <div className="mt-7 grid min-w-0 grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
                    <div className="h-full min-w-0">
                      <InvoiceTable
                        invoices={invoiceResult?.data ?? []}
                        query={query}
                        statusFilter={statusFilter}
                        sortBy={sortBy}
                        pagination={invoiceResult?.pagination ?? null}
                        loading={invoiceState === 'loading'}
                        error={invoiceState === 'error' ? invoiceError : null}
                        onStatusFilter={(status) => {
                          setInvoiceState('loading')
                          setStatusFilter(status)
                          setPage(1)
                        }}
                        onSortBy={(value) => {
                          setInvoiceState('loading')
                          setSortBy(value)
                          setPage(1)
                        }}
                        onSortOrder={() => {
                          setInvoiceState('loading')
                          setSortOrder((order) => order === 'asc' ? 'desc' : 'asc')
                        }}
                        onPage={(nextPage) => {
                          setInvoiceState('loading')
                          setPage(nextPage)
                        }}
                        onRetry={() => {
                          setInvoiceState('loading')
                          setRefreshKey((key) => key + 1)
                        }}
                        onView={(invoice) => setDialog({ type: 'details', invoice })}
                        onEdit={(invoice) => openForm(invoice)}
                        selectedInvoiceIds={selectedInvoiceIds}
                        onToggleInvoice={toggleInvoiceSelection}
                        onCreatePaymentPlan={startPaymentPlan}
                        creatingPaymentPlan={creatingPaymentPlan}
                        paymentPlanError={paymentPlanError}
                        sortOrder={sortOrder}
                      />
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1">
                      <UpcomingPayments
                        invoices={upcomingInvoices}
                        error={upcomingError}
                        onViewPending={() => showInvoicesWithStatus('PENDING')}
                      />
                      <RecommendationCard
                        overdueCount={summary?.overdueCount ?? 0}
                        message={assistantQuestion}
                        response={assistantResponse}
                        loading={assistantLoading}
                        error={assistantError}
                        questionRef={assistantQuestionRef}
                        onMessageChange={setAssistantQuestion}
                        onSubmit={submitAssistantQuestion}
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid items-stretch gap-5 xl:grid-cols-2">
                    <ActivityChart range={activityRange} />
                    <RecentActivity />
                  </div>
                  <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500">
                    <p>PayPilot AI · {authMode === 'demo' ? 'Development demo workspace' : 'Private account workspace'}</p>
                    <p>PayPal Sandbox only · only backend-verified captures are marked successful</p>
                  </footer>
            </div>
          </main>
        </div>
      </div>
      {dialog?.type === 'form' && (
        <InvoiceFormDialog
          key={dialog.invoice?.id ?? 'new-invoice'}
          invoice={dialog.invoice}
          error={formError}
          saving={savingInvoice}
          onClose={() => setDialog(null)}
          onSave={saveInvoice}
        />
      )}
      {dialog?.type === 'details' && (
        <InvoiceDetailsDialog
          invoice={dialog.invoice}
          onClose={() => setDialog(null)}
          onEdit={() => openForm(dialog.invoice)}
        />
      )}
      {paymentPlan && (
        <PaymentPlanDialog
          initialPlan={paymentPlan}
          onClose={() => setPaymentPlan(null)}
          onRefresh={() => {
            setInvoiceState('loading')
            setRefreshKey((key) => key + 1)
          }}
        />
      )}
      {accountError && (
        <div className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-center gap-3 rounded-xl border border-rose-200 bg-white p-4 text-sm text-rose-700 shadow-xl" role="alert">
          <span className="flex-1">{accountError}</span>
          <button aria-label="Dismiss account error" onClick={() => setAccountError(null)} className="rounded-lg px-2 py-1 font-semibold hover:bg-rose-50">
            Dismiss
          </button>
        </div>
      )}
      {profileDialogOpen && (
        <ProfileDialog
          user={user}
          onClose={() => setProfileDialogOpen(false)}
          onSave={saveProfile}
        />
      )}
      {helpDialogOpen && <HelpDialog onClose={() => setHelpDialogOpen(false)} />}
    </div>
  )
}

function App() {
  const [session, setSession] = useState<AuthSessionResponse | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)

  async function refreshSession() {
    setLoadingSession(true)
    setSessionError(null)
    try {
      setSession(await getAuthSession())
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Could not check your account session.')
    } finally {
      setLoadingSession(false)
    }
  }

  useEffect(() => {
    let active = true
    getAuthSession()
      .then((currentSession) => {
        if (active) setSession(currentSession)
      })
      .catch((error: unknown) => {
        if (active) {
          setSessionError(error instanceof Error
            ? error.message
            : 'Could not check your account session.')
        }
      })
      .finally(() => {
        if (active) setLoadingSession(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loadingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] text-sm text-slate-500" role="status">
        Checking your account…
      </main>
    )
  }

  if (sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-4">
        <section className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-lg">
          <h1 className="text-lg font-semibold text-slate-900">Account service unavailable</h1>
          <p className="mt-2 text-sm text-rose-700">{sessionError}</p>
          <button onClick={() => void refreshSession()} className="mt-4 rounded-xl bg-[#17233e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#243654]">
            Try again
          </button>
        </section>
      </main>
    )
  }

  if (!session?.data) {
    return (
      <AuthScreen
        onAuthenticated={(user) => setSession({ data: user, authMode: 'session' })}
      />
    )
  }

  return (
    <Dashboard
      key={session.data.id}
      user={session.data}
      authMode={session.authMode ?? 'session'}
      onProfileUpdated={(user) => setSession({ ...session, data: user })}
      onSignedOut={() => setSession(null)}
    />
  )
}

export default App
