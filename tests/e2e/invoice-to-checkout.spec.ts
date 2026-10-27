import { expect, test } from '@playwright/test'

const invoice = {
  id: 'fixture-invoice-001',
  title: 'DEMO - E2E Hosting Invoice',
  counterparty: 'Fictional Browser Test Supplier',
  amountMinor: 12_345,
  currency: 'USD',
  dueDate: '2026-11-15T00:00:00.000Z',
  status: 'PENDING',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

test('selects an invoice, approves its plan, and reaches mocked Sandbox checkout', async ({ page }) => {
  let planStatus = 'PROPOSED'
  let orderRequests = 0
  let captureRequests = 0
  let authUser: {
    id: string
    name: string
    email: string
    createdAt: string
  } | null = {
    id: 'fixture-user-001',
    name: 'Jordan Morgan',
    email: 'jordan@example.test',
    createdAt: '2026-10-01T00:00:00.000Z',
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/auth/session' && request.method() === 'GET') {
      await route.fulfill({ json: { data: authUser, authMode: authUser ? 'session' : null } })
      return
    }

    if (path === '/api/auth/profile' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { name: string; email: string }
      authUser = { ...authUser!, ...body }
      await route.fulfill({ json: { data: authUser } })
      return
    }

    if (path === '/api/auth/logout' && request.method() === 'POST') {
      authUser = null
      await route.fulfill({ json: { data: null } })
      return
    }

    if (path === '/api/auth/login' && request.method() === 'POST') {
      authUser = {
        id: 'fixture-user-001',
        name: 'Jordan Updated',
        email: 'jordan@example.test',
        createdAt: '2026-10-01T00:00:00.000Z',
      }
      await route.fulfill({ json: { data: authUser, expiresAt: '2026-10-30T00:00:00.000Z' } })
      return
    }

    if (path === '/api/invoices' && request.method() === 'GET') {
      await route.fulfill({
        json: {
          data: [invoice],
          pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
          summary: {
            outstandingByCurrency: { USD: invoice.amountMinor, INR: 5000 },
            overdueByCurrency: {},
            overdueCount: 0,
            upcomingByCurrency: { USD: invoice.amountMinor },
            upcomingCount: 1,
            completedByCurrency: {},
            completedCount: 0,
          },
        },
      })
      return
    }

    if (path === '/api/payments/config') {
      await route.fulfill({
        json: {
          data: {
            environment: 'sandbox',
            configured: true,
            clientId: 'TEST_PUBLIC_CLIENT_ID',
          },
        },
      })
      return
    }

    if (path === '/api/payment-plans' && request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        json: {
          data: {
            id: 'fixture-plan-001',
            status: planStatus,
            proposalVersion: 'a'.repeat(64),
            totalAmount: invoice.amountMinor,
            currency: invoice.currency,
            expiresAt: '2026-10-24T00:00:00.000Z',
            approvedAt: null,
            createdAt: '2026-10-23T00:00:00.000Z',
            invoices: [{
              id: invoice.id,
              title: invoice.title,
              counterparty: invoice.counterparty,
              amountMinor: invoice.amountMinor,
              currency: invoice.currency,
              dueDate: invoice.dueDate,
              status: invoice.status,
              updatedAt: invoice.updatedAt,
            }],
          },
        },
      })
      return
    }

    if (path === '/api/payment-plans/fixture-plan-001/approve') {
      planStatus = 'APPROVED'
      await route.fulfill({
        json: {
          data: {
            id: 'fixture-plan-001',
            status: planStatus,
            proposalVersion: 'a'.repeat(64),
            totalAmount: invoice.amountMinor,
            currency: invoice.currency,
            expiresAt: '2026-10-24T00:00:00.000Z',
            approvedAt: '2026-10-23T00:00:01.000Z',
            createdAt: '2026-10-23T00:00:00.000Z',
            invoices: [{
              id: invoice.id,
              title: invoice.title,
              counterparty: invoice.counterparty,
              amountMinor: invoice.amountMinor,
              currency: invoice.currency,
              dueDate: invoice.dueDate,
              status: invoice.status,
              updatedAt: invoice.updatedAt,
            }],
          },
        },
      })
      return
    }

    if (path === '/api/payment-plans/fixture-plan-001/order') {
      orderRequests += 1
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body).toEqual({ proposalVersion: 'a'.repeat(64) })
      await route.fulfill({
        json: {
          data: {
            id: 'fixture-attempt-001',
            paymentPlanId: 'fixture-plan-001',
            paypalOrderId: 'SANDBOX-ORDER-FIXTURE',
            captureId: null,
            amountMinor: invoice.amountMinor,
            currency: invoice.currency,
            status: 'PENDING',
            providerStatus: 'CREATED',
            invoiceIds: [invoice.id],
            createdAt: '2026-10-23T00:00:02.000Z',
            updatedAt: '2026-10-23T00:00:02.000Z',
          },
        },
      })
      return
    }

    if (path.endsWith('/capture')) captureRequests += 1
    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected test request' } } })
  })

  await page.route('https://www.paypal.com/sdk/js**', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.paypal = {
          Buttons: function (options) {
            return {
              isEligible: function () { return true; },
              render: async function (container) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'Mock PayPal Sandbox checkout';
                button.addEventListener('click', async function () {
                  await options.createOrder();
                });
                container.appendChild(button);
              },
              close: async function () {},
              updateProps: function () {}
            };
          }
        };
      `,
    })
  })

  await page.goto('/')
  await expect(page.getByText('$123.45 + ₹50.00')).toBeVisible()

  await page.getByRole('button', { name: 'Open workspace menu' }).click()
  await expect(page.getByText('Workspace switching is not available.')).toBeVisible()
  await page.getByRole('button', { name: 'Open workspace menu' }).click()

  await page.getByRole('button', { name: 'Help & support' }).click()
  await expect(page.getByRole('dialog', { name: 'Help & support' })).toBeVisible()
  await page.getByRole('button', { name: 'Close help' }).click()

  await page.getByRole('button', { name: 'More profile options' }).click()
  await page.getByRole('button', { name: 'Manage profile' }).click()
  const profile = page.getByRole('dialog', { name: 'Manage profile' })
  await profile.getByLabel('Full name').fill('Jordan Updated')
  await profile.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText('Jordan Updated').first()).toBeVisible()

  await page.getByRole('button', { name: 'More profile options' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.getByLabel('Email').fill('jordan@example.test')
  await page.getByLabel('Password').fill('fictional-test-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /Welcome, Jordan/ })).toBeVisible()

  await page.getByRole('button', { name: 'Activity date range: Last 30 days' }).click()
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click()
  await expect(page.getByText('Last 7 days').first()).toBeVisible()

  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByRole('region', { name: 'Invoice notifications' })).toContainText(
    'Pending invoices',
  )
  await page.getByRole('region', { name: 'Invoice notifications' })
    .getByRole('button', { name: /Pending invoices/ })
    .click()
  await expect(page.getByLabel('Filter invoices by status')).toHaveValue('PENDING')
  await expect(page.getByRole('button', { name: invoice.title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View pending invoices' }).click()
  await expect(page.getByLabel('Filter invoices by status')).toHaveValue('PENDING')
  await expect(page.getByRole('button', { name: invoice.title, exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Add invoice' }).click()
  const invoiceForm = page.getByRole('dialog', { name: 'Create invoice' })
  await invoiceForm.getByLabel('Currency').selectOption('INR')
  await expect(invoiceForm.getByLabel('Currency')).toHaveValue('INR')
  await invoiceForm.getByRole('button', { name: 'Close invoice form' }).first().click()

  const activityDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await activityDownload).suggestedFilename()).toBe('paypilot-demo-activity.csv')

  await page.getByRole('button', { name: 'Explore recommendations' }).click()
  await expect(page.getByRole('textbox', {
    name: 'Ask PayPilot AI about your invoices',
  })).toBeFocused()
  await expect(page.locator('#recommendation')).toBeInViewport()

  await page.getByRole('checkbox', {
    name: `Select ${invoice.title} for a payment plan`,
  }).check()
  await page.setViewportSize({ width: 1600, height: 1200 })
  await page.screenshot({
    path: 'docs/screenshots/dashboard.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Create payment plan (1)' }).click()

  const dialog = page.getByRole('dialog', { name: 'Review exact plan' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox', {
    name: 'I approve this exact plan total and currency.',
  }).check()
  await dialog.getByRole('button', { name: 'Approve exact plan' }).click()

  await expect(dialog.getByText('PayPal Sandbox checkout', { exact: true })).toBeVisible()
  const checkoutButton = dialog.getByRole('button', { name: 'Mock PayPal Sandbox checkout' })
  await expect(checkoutButton).toBeVisible()
  await checkoutButton.click()
  await expect(dialog.getByText(/Backend attempt:/)).toContainText('PENDING')

  expect(orderRequests).toBe(1)
  expect(captureRequests).toBe(0)
})
