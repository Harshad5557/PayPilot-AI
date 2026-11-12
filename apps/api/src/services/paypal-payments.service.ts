import { createHash } from 'node:crypto';
import {
  InvoiceStatus,
  PaymentAttemptStatus,
  PaymentPlanStatus,
} from '../generated/prisma/client.js';
import { HttpError } from '../errors/http-error.js';
import {
  createPaymentAttemptAuditEvent,
  createPaymentAttemptInTransaction,
  findActiveAttemptsForInvoices,
  findPaymentAttemptByIdempotencyKeyInTransaction,
  findPaymentAttemptInTransaction,
  updateAttemptInvoicesAsPaid,
  updatePaymentAttempt,
} from '../repositories/payment-attempts.repository.js';
import {
  createPaymentPlanAuditEvent,
  findInvoicesForPaymentPlan,
  findPaymentPlanByIdInTransaction,
  updatePaymentPlan,
  withPaymentPlanTransaction,
} from '../repositories/payment-plans.repository.js';
import {
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalSandboxConfiguration,
  getPayPalOrder,
  PayPalProviderError,
  type PayPalCaptureInput,
  type PayPalOrderInput,
} from './paypal.provider.js';
import { verifyApprovedPaymentPlanForExecution } from './payment-execution.service.js';
import {
  paypalCaptureRequestSchema,
  paypalCaptureResponseSchema,
  paypalOrderResponseSchema,
  paypalRetrievedOrderSchema,
  paymentAttemptIdSchema,
} from '../validation/paypal.validation.js';
import { minorUnitsToAmount } from './money.js';

const CAPTURE_REQUEST_TIMEOUT_RECOVERY_MS = 30_000;

export interface PayPalPaymentProvider {
  createOrder: (input: PayPalOrderInput) => Promise<unknown>;
  captureOrder: (input: PayPalCaptureInput) => Promise<unknown>;
  getOrder?: (orderId: string) => Promise<unknown>;
}

const defaultProvider: PayPalPaymentProvider = {
  createOrder: createPayPalOrder,
  captureOrder: capturePayPalOrder,
  getOrder: getPayPalOrder,
};

function providerRequestId(kind: 'order' | 'capture', proposalVersion: string) {
  return createHash('sha256')
    .update(`paypilot:${kind}:${proposalVersion}`)
    .digest('hex')
    .slice(0, 36);
}

function attemptResponse(attempt: {
  id: string;
  paymentPlanId: string | null;
  providerOrderId: string | null;
  providerCaptureId: string | null;
  amount: number;
  currency: string;
  status: PaymentAttemptStatus;
  providerStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  invoiceAllocations: { invoiceId: string; amount: number; currency: string }[];
}) {
  return {
    id: attempt.id,
    paymentPlanId: attempt.paymentPlanId,
    paypalOrderId: attempt.providerOrderId,
    captureId: attempt.providerCaptureId,
    amountMinor: attempt.amount,
    currency: attempt.currency,
    status: attempt.status,
    providerStatus: attempt.providerStatus,
    invoiceIds: attempt.invoiceAllocations.map(({ invoiceId }) => invoiceId),
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

function attemptIsProcessing(status: PaymentAttemptStatus) {
  return (
    status === PaymentAttemptStatus.PENDING ||
    status === PaymentAttemptStatus.CAPTURING ||
    status === PaymentAttemptStatus.AMBIGUOUS
  );
}

function verifiedOrder(
  response: unknown,
  expected: {
    attemptId: string;
    orderId: string;
    totalAmount: number;
    currency: string;
  },
) {
  const parsed = paypalRetrievedOrderSchema.safeParse(response);
  if (!parsed.success) {
    throw new HttpError(
      'PayPal returned an invalid order response.',
      502,
      'PAYPAL_INVALID_ORDER_RESPONSE',
    );
  }

  const order = parsed.data;
  const purchaseUnit = order.purchase_units[0]!;
  if (order.id !== expected.orderId) {
    throw new HttpError(
      'PayPal returned a different order than the payment attempt.',
      409,
      'PAYPAL_ORDER_MISMATCH',
    );
  }
  if (
    purchaseUnit.custom_id !== expected.attemptId ||
    purchaseUnit.reference_id !== expected.attemptId
  ) {
    throw new HttpError(
      'PayPal order does not match this payment attempt.',
      409,
      'PAYPAL_ORDER_ATTEMPT_MISMATCH',
    );
  }
  if (
    purchaseUnit.amount.currency_code !== expected.currency ||
    purchaseUnit.amount.value !== minorUnitsToAmount(expected.totalAmount, expected.currency)
  ) {
    throw new HttpError(
      'PayPal order amount or currency does not match.',
      409,
      'PAYPAL_ORDER_AMOUNT_MISMATCH',
    );
  }

  return order;
}

function verifiedOrderCapture(
  order: ReturnType<typeof verifiedOrder>,
  expected: { totalAmount: number; currency: string },
) {
  if (order.status !== 'COMPLETED') return undefined;
  const capture = order.purchase_units[0]!.payments?.captures?.[0];
  if (
    !capture ||
    capture.status !== 'COMPLETED' ||
    capture.amount.currency_code !== expected.currency ||
    capture.amount.value !== minorUnitsToAmount(expected.totalAmount, expected.currency)
  ) {
    return undefined;
  }
  return capture;
}

function throwProviderFailure(error: unknown, action: 'order' | 'capture', attemptId?: string) {
  if (error instanceof PayPalProviderError) {
    if (
      action === 'capture' &&
      (error.providerCode === 'INSTRUMENT_DECLINED' || error.providerCode === 'PAYMENT_DENIED')
    ) {
      throw new HttpError(
        'PayPal declined this payment. No successful capture was recorded.',
        402,
        'PAYMENT_DECLINED',
      );
    }
    throw new HttpError(
      error.certainty === 'ambiguous'
        ? `PayPal ${action} outcome is uncertain. Check the payment attempt before retrying.`
        : `PayPal could not ${action === 'order' ? 'create the order' : 'capture the order'}.`,
      error.certainty === 'ambiguous' ? 503 : 502,
      error.certainty === 'ambiguous'
        ? `PAYPAL_${action.toUpperCase()}_AMBIGUOUS`
        : `PAYPAL_${action.toUpperCase()}_FAILED`,
      attemptId ? { paymentAttemptId: attemptId } : undefined,
    );
  }
  throw new HttpError(
    `PayPal ${action} outcome is uncertain. Check the payment attempt before retrying.`,
    503,
    `PAYPAL_${action.toUpperCase()}_AMBIGUOUS`,
  );
}

function ownedAttemptError() {
  return new HttpError('Payment attempt not found.', 404);
}

async function recordAttemptState(
  ownerId: string,
  attemptId: string,
  statuses: PaymentAttemptStatus[],
  status: PaymentAttemptStatus,
  eventType: string,
  metadata: Record<string, string | number | boolean | undefined> = {},
  providerStatus?: string,
  providerErrorCode?: string,
) {
  return withPaymentPlanTransaction(async (transaction) => {
    await updatePaymentAttempt(transaction, ownerId, attemptId, statuses, {
      status,
      providerStatus,
      providerErrorCode,
    });
    const attempt = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!attempt) throw ownedAttemptError();
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType,
      entityId: attemptId,
      metadata: {
        ...metadata,
        status,
        paypalOrderId: attempt.providerOrderId ?? undefined,
      },
    });
    return attempt;
  });
}

async function recordReconciledOrderState(
  ownerId: string,
  attemptId: string,
  status: PaymentAttemptStatus,
  providerStatus: string,
  eventType: string,
  providerErrorCode: string | null = null,
) {
  return withPaymentPlanTransaction(async (transaction) => {
    const update = await updatePaymentAttempt(
      transaction,
      ownerId,
      attemptId,
      [
        PaymentAttemptStatus.AMBIGUOUS,
        PaymentAttemptStatus.PENDING,
        PaymentAttemptStatus.CAPTURING,
      ],
      { status, providerStatus, providerErrorCode },
    );
    const attempt = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!attempt) throw ownedAttemptError();
    if (update.count !== 1) {
      if (attempt.status === PaymentAttemptStatus.SUCCEEDED) return attempt;
      throw new HttpError(
        'Payment attempt changed while reconciliation was in progress.',
        409,
        'PAYMENT_ATTEMPT_CHANGED',
      );
    }
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType,
      entityId: attemptId,
      metadata: {
        paypalOrderId: attempt.providerOrderId ?? undefined,
        providerStatus,
      },
    });
    const reloaded = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!reloaded) throw ownedAttemptError();
    return reloaded;
  });
}

async function ensureAttempt(
  authorization: Awaited<ReturnType<typeof verifyApprovedPaymentPlanForExecution>>,
) {
  const idempotencyKey = `paypal-order:${authorization.proposalVersion}`;
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const existing = await findPaymentAttemptByIdempotencyKeyInTransaction(
      transaction,
      idempotencyKey,
    );
    if (existing) {
      if (
        existing.ownerId !== authorization.ownerId ||
        existing.paymentPlanId !== authorization.paymentPlanId ||
        existing.amount !== authorization.totalAmount ||
        existing.currency !== authorization.currency
      ) {
        return {
          error: new HttpError(
            'Payment attempt idempotency conflict.',
            409,
            'IDEMPOTENCY_CONFLICT',
          ),
        };
      }
      return { attempt: existing };
    }

    const plan = await findPaymentPlanByIdInTransaction(
      transaction,
      authorization.ownerId,
      authorization.paymentPlanId,
    );
    if (
      !plan ||
      plan.status !== PaymentPlanStatus.APPROVED ||
      plan.proposalVersion !== authorization.proposalVersion ||
      plan.approvedProposalVersion !== authorization.proposalVersion ||
      plan.approvedAmount !== authorization.totalAmount ||
      plan.approvedCurrency !== authorization.currency ||
      !plan.approvedAt ||
      Date.now() >= plan.expiresAt.getTime()
    ) {
      return {
        error: new HttpError(
          'The approved payment plan is no longer valid.',
          409,
          'APPROVAL_REQUIRED',
        ),
      };
    }

    const invoices = await findInvoicesForPaymentPlan(
      transaction,
      authorization.ownerId,
      authorization.invoiceIds,
    );
    const currentById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const exactInvoiceSet =
      invoices.length === authorization.invoices.length &&
      authorization.invoices.every((snapshot) => {
        const invoice = currentById.get(snapshot.id);
        return (
          invoice !== undefined &&
          invoice.amount === snapshot.amountMinor &&
          invoice.currency === snapshot.currency &&
          (invoice.status === InvoiceStatus.PENDING || invoice.status === InvoiceStatus.OVERDUE)
        );
      });
    if (!exactInvoiceSet) {
      await updatePaymentPlan(
        transaction,
        authorization.ownerId,
        authorization.paymentPlanId,
        [PaymentPlanStatus.APPROVED],
        { status: PaymentPlanStatus.STALE },
      );
      await createPaymentPlanAuditEvent(transaction, {
        ownerId: authorization.ownerId,
        eventType: 'PAYMENT_PLAN_FAILED',
        entityId: authorization.paymentPlanId,
        metadata: {
          reason: 'INVOICE_DATA_CHANGED',
          proposalVersion: authorization.proposalVersion,
        },
      });
      return {
        error: new HttpError(
          'Invoice data changed. Create a new payment plan.',
          409,
          'PAYMENT_PLAN_STALE',
        ),
      };
    }

    const activeAttempts = await findActiveAttemptsForInvoices(
      transaction,
      authorization.invoiceIds,
    );
    if (activeAttempts.length > 0) {
      return {
        error: new HttpError(
          'An active payment attempt already exists for one or more invoices.',
          409,
          'PAYMENT_ATTEMPT_ACTIVE',
        ),
      };
    }

    const sorted = authorization.invoices;
    if (!sorted.length) {
      return {
        error: new HttpError('The payment plan has no invoices.', 409, 'INVALID_PAYMENT_PLAN'),
      };
    }
    const attempt = await createPaymentAttemptInTransaction(transaction, {
      ownerId: authorization.ownerId,
      invoiceId: sorted[0]!.id,
      paymentPlanId: authorization.paymentPlanId,
      amount: authorization.totalAmount,
      currency: authorization.currency,
      status: PaymentAttemptStatus.PENDING,
      idempotencyKey,
      invoiceAllocations: {
        create: sorted.map((invoice) => ({
          invoiceId: invoice.id,
          amount: invoice.amountMinor,
          currency: invoice.currency,
        })),
      },
    });
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId: authorization.ownerId,
      eventType: 'PAYMENT_ATTEMPT_CREATED',
      entityId: attempt.id,
      metadata: {
        paymentPlanId: authorization.paymentPlanId,
        proposalVersion: authorization.proposalVersion,
        amount: authorization.totalAmount,
        currency: authorization.currency,
        invoiceCount: sorted.length,
      },
    });
    return { attempt };
  });
  if (result.error) throw result.error;
  if (!result.attempt) throw new HttpError('Could not initialize the payment attempt.', 500);
  return result.attempt;
}

export async function createApprovedPayPalOrder(
  ownerId: string,
  paymentPlanId: string,
  proposalVersion: string,
  provider: PayPalPaymentProvider = defaultProvider,
  sandboxConfigured = getPayPalSandboxConfiguration().configured,
) {
  if (!sandboxConfigured) {
    throw new HttpError(
      'PayPal Sandbox is not configured on the server.',
      503,
      'PAYPAL_NOT_CONFIGURED',
    );
  }
  const authorization = await verifyApprovedPaymentPlanForExecution(ownerId, paymentPlanId);
  if (authorization.proposalVersion !== proposalVersion) {
    throw new HttpError(
      'The payment plan version does not match.',
      409,
      'PROPOSAL_VERSION_MISMATCH',
    );
  }
  const attempt = await ensureAttempt(authorization);
  if (attempt.providerOrderId) {
    if (attempt.status === PaymentAttemptStatus.PENDING) {
      return attemptResponse(attempt);
    }
    if (attempt.status === PaymentAttemptStatus.AMBIGUOUS) {
      throw new HttpError(
        'This PayPal order must be reconciled before checkout can continue.',
        409,
        'PAYPAL_ORDER_RECONCILIATION_REQUIRED',
        { paymentAttemptId: attempt.id },
      );
    }
    throw new HttpError(
      'This payment attempt can no longer create an order.',
      409,
      'INVALID_PAYMENT_ATTEMPT_STATE',
    );
  }
  if (attempt.status === PaymentAttemptStatus.AMBIGUOUS) {
    throw new HttpError(
      'This ambiguous payment attempt must be reconciled or recovered before creating an order.',
      409,
      'PAYPAL_ORDER_RECOVERY_REQUIRED',
      { paymentAttemptId: attempt.id },
    );
  }
  if (
    attempt.status !== PaymentAttemptStatus.PENDING
  ) {
    throw new HttpError(
      'This payment attempt can no longer create an order.',
      409,
      'INVALID_PAYMENT_ATTEMPT_STATE',
    );
  }

  let providerResult: unknown;
  try {
    providerResult = await provider.createOrder({
      attemptId: attempt.id,
      requestId: providerRequestId('order', authorization.proposalVersion),
      totalAmount: authorization.totalAmount,
      currency: authorization.currency,
    });
  } catch (error) {
    const failure =
      error instanceof PayPalProviderError
        ? error
        : new PayPalProviderError('PayPal outcome is uncertain.', 'ambiguous');
    const status =
      failure.certainty === 'ambiguous'
        ? PaymentAttemptStatus.AMBIGUOUS
        : PaymentAttemptStatus.FAILED;
    await recordAttemptState(
      ownerId,
      attempt.id,
      [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.AMBIGUOUS],
      status,
      failure.certainty === 'ambiguous' ? 'PAYPAL_ORDER_AMBIGUOUS' : 'PAYPAL_ORDER_FAILED',
      { providerErrorCode: failure.providerCode },
      undefined,
      failure.providerCode,
    );
    throwProviderFailure(failure, 'order', attempt.id);
  }

  const parsed = paypalOrderResponseSchema.safeParse(providerResult);
  if (!parsed.success) {
    const raw = providerResult && typeof providerResult === 'object'
      ? (providerResult as Record<string, unknown>)
      : undefined;
    console.error('[PayPal order response diagnostic]', {
      hasId: Boolean(raw?.id),
      status:
        typeof raw?.status === 'string' && /^[A-Z_]{1,40}$/.test(raw.status)
          ? raw.status
          : undefined,
      hasIntent: Boolean(raw?.intent),
      hasPurchaseUnits: Array.isArray(raw?.purchase_units),
      hasLinks: Array.isArray(raw?.links),
    });
  }
  const order = parsed.success ? parsed.data : undefined;
  const purchaseUnit = order?.purchase_units[0];
  if (
    !order ||
    !purchaseUnit ||
    (purchaseUnit.reference_id !== undefined && purchaseUnit.reference_id !== attempt.id) ||
    (purchaseUnit.custom_id !== undefined && purchaseUnit.custom_id !== attempt.id) ||
    purchaseUnit.amount.currency_code !== authorization.currency ||
    purchaseUnit.amount.value !==
      minorUnitsToAmount(authorization.totalAmount, authorization.currency)
  ) {
    await recordAttemptState(
      ownerId,
      attempt.id,
      [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.AMBIGUOUS],
      PaymentAttemptStatus.AMBIGUOUS,
      'PAYPAL_ORDER_RESPONSE_UNEXPECTED',
    );
    throw new HttpError(
      'PayPal returned an unexpected order response. The outcome is uncertain; check the attempt before retrying.',
      502,
      'PAYPAL_UNEXPECTED_RESPONSE',
      { paymentAttemptId: attempt.id },
    );
  }

  const saved = await withPaymentPlanTransaction(async (transaction) => {
    const update = await transaction.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        ownerId,
        status: { in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.AMBIGUOUS] },
        providerOrderId: null,
      },
      data: {
        providerOrderId: order.id,
        providerStatus: order.status,
        status: PaymentAttemptStatus.PENDING,
        providerErrorCode: null,
      },
    });
    const current = await findPaymentAttemptInTransaction(transaction, ownerId, attempt.id);
    if (!current) throw ownedAttemptError();
    if (update.count === 1) {
      await createPaymentAttemptAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYPAL_ORDER_CREATED',
        entityId: attempt.id,
        metadata: {
          paypalOrderId: order.id,
          paymentPlanId,
          proposalVersion,
          amount: authorization.totalAmount,
          currency: authorization.currency,
        },
      });
    }
    if (current.providerOrderId && current.providerOrderId !== order.id) {
      throw new HttpError(
        'PayPal order does not match the local payment attempt.',
        502,
        'PAYPAL_ORDER_MISMATCH',
      );
    }
    return current;
  });
  return attemptResponse(saved);
}

export async function recoverAmbiguousPayPalOrder(
  input: { attemptId: string; orderId: string; userId: string },
  provider: PayPalPaymentProvider = defaultProvider,
) {
  const parsedAttemptId = paymentAttemptIdSchema.safeParse(input.attemptId);
  if (!parsedAttemptId.success) {
    throw new HttpError('Payment attempt ID is invalid.', 400, 'INVALID_PAYMENT_ATTEMPT_ID');
  }
  const parsedOrderId = paypalCaptureRequestSchema.safeParse({ orderId: input.orderId });
  if (!parsedOrderId.success) {
    throw new HttpError('PayPal order ID is invalid.', 400, 'INVALID_PAYPAL_ORDER_ID');
  }
  const orderId = parsedOrderId.data.orderId;
  const attempt = await withPaymentPlanTransaction((transaction) =>
    findPaymentAttemptInTransaction(transaction, input.userId, parsedAttemptId.data),
  );
  if (!attempt) throw ownedAttemptError();
  if (attempt.status !== PaymentAttemptStatus.AMBIGUOUS || attempt.providerOrderId !== null) {
    throw new HttpError(
      'Only an ambiguous attempt without a linked PayPal order can be recovered.',
      409,
      'PAYPAL_ORDER_NOT_RECOVERABLE',
    );
  }
  if (!provider.getOrder) {
    throw new HttpError(
      'PayPal order recovery is unavailable.',
      503,
      'PAYMENT_RECONCILIATION_UNAVAILABLE',
    );
  }

  let providerResult: unknown;
  try {
    providerResult = await provider.getOrder(orderId);
  } catch {
    throw new HttpError(
      'PayPal order could not be verified. The attempt remains unresolved.',
      503,
      'PAYPAL_ORDER_RECOVERY_UNAVAILABLE',
    );
  }
  const order = verifiedOrder(providerResult, {
    attemptId: attempt.id,
    orderId,
    totalAmount: attempt.amount,
    currency: attempt.currency,
  });

  const recovered = await withPaymentPlanTransaction(async (transaction) => {
    const update = await transaction.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        ownerId: input.userId,
        status: PaymentAttemptStatus.AMBIGUOUS,
        providerOrderId: null,
      },
      data: {
        providerOrderId: order.id,
        providerStatus: order.status,
      },
    });
    const current = await findPaymentAttemptInTransaction(
      transaction,
      input.userId,
      attempt.id,
    );
    if (!current) throw ownedAttemptError();
    if (update.count === 0) {
      if (current.providerOrderId === order.id) return current;
      throw new HttpError(
        'Payment attempt changed while order recovery was in progress.',
        409,
        'PAYPAL_ORDER_RECOVERY_CONFLICT',
      );
    }
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId: input.userId,
      eventType: 'PAYPAL_ORDER_RECOVERED',
      entityId: attempt.id,
      metadata: {
        orderId: order.id,
        attemptId: attempt.id,
        recoveryMethod: 'VERIFIED_PROVIDER_LOOKUP',
      },
    });
    const reloaded = await findPaymentAttemptInTransaction(
      transaction,
      input.userId,
      attempt.id,
    );
    if (!reloaded) throw ownedAttemptError();
    return reloaded;
  });

  return attemptResponse(recovered);
}

export async function getPaymentAttempt(ownerId: string, id: string) {
  const attempt = await withPaymentPlanTransaction((transaction) =>
    findPaymentAttemptInTransaction(transaction, ownerId, id),
  );
  if (!attempt) throw ownedAttemptError();
  return attemptResponse(attempt);
}

export async function reconcilePayPalAttempt(
  ownerId: string,
  id: string,
  provider: PayPalPaymentProvider = defaultProvider,
) {
  const attempt = await withPaymentPlanTransaction((transaction) =>
    findPaymentAttemptInTransaction(transaction, ownerId, id),
  );
  if (!attempt) throw ownedAttemptError();
  if (attempt.status === PaymentAttemptStatus.SUCCEEDED) {
    return { ...attemptResponse(attempt), processing: false };
  }
  if (
    attempt.status !== PaymentAttemptStatus.AMBIGUOUS &&
    attempt.status !== PaymentAttemptStatus.PENDING &&
    attempt.status !== PaymentAttemptStatus.CAPTURING
  ) {
    throw new HttpError(
      'Only a pending or unresolved payment attempt can be reconciled.',
      409,
      'INVALID_PAYMENT_ATTEMPT_STATE',
    );
  }
  const providerOrderId = attempt.providerOrderId;
  if (!providerOrderId) {
    throw new HttpError(
      'PayPal order is not available for this attempt.',
      409,
      'PAYPAL_ORDER_REQUIRED',
    );
  }
  if (!provider.getOrder) {
    throw new HttpError(
      'PayPal status reconciliation is unavailable.',
      503,
      'PAYMENT_RECONCILIATION_UNAVAILABLE',
    );
  }

  await withPaymentPlanTransaction(async (transaction) => {
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_RECONCILIATION_STARTED',
      entityId: id,
      metadata: { paypalOrderId: providerOrderId },
    });
  });

  let providerResult: unknown;
  try {
    providerResult = await provider.getOrder(providerOrderId);
  } catch (error) {
    await withPaymentPlanTransaction(async (transaction) => {
      await createPaymentAttemptAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_RECONCILIATION_FAILED',
        entityId: id,
        metadata: {
          paypalOrderId: providerOrderId,
          providerErrorCode: error instanceof PayPalProviderError ? error.providerCode : undefined,
        },
      });
    });
    throw new HttpError(
      'PayPal status could not be verified. The payment remains unresolved.',
      503,
      'PAYMENT_RECONCILIATION_UNAVAILABLE',
    );
  }

  let order: ReturnType<typeof verifiedOrder>;
  try {
    order = verifiedOrder(providerResult, {
      attemptId: attempt.id,
      orderId: providerOrderId,
      totalAmount: attempt.amount,
      currency: attempt.currency,
    });
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    await withPaymentPlanTransaction(async (transaction) => {
      await createPaymentAttemptAuditEvent(transaction, {
        ownerId,
        eventType: 'PAYMENT_RECONCILIATION_UNRESOLVED',
        entityId: id,
        metadata: { paypalOrderId: providerOrderId, reason: error.code },
      });
    });
    const latest = await withPaymentPlanTransaction((transaction) =>
      findPaymentAttemptInTransaction(transaction, ownerId, id),
    );
    if (!latest) throw ownedAttemptError();
    return { ...attemptResponse(latest), processing: attemptIsProcessing(latest.status) };
  }

  switch (order.status) {
    case 'CREATED':
    case 'SAVED':
    case 'PAYER_ACTION_REQUIRED': {
      const current = await recordReconciledOrderState(
        ownerId,
        id,
        PaymentAttemptStatus.PENDING,
        order.status,
        'PAYMENT_RECONCILIATION_PENDING',
      );
      return { ...attemptResponse(current), processing: attemptIsProcessing(current.status) };
    }
    case 'APPROVED': {
      await recordReconciledOrderState(
        ownerId,
        id,
        PaymentAttemptStatus.PENDING,
        order.status,
        'PAYMENT_RECONCILIATION_APPROVED',
      );
      return capturePayPalAttempt(ownerId, id, providerOrderId, provider);
    }
    case 'VOIDED': {
      const current = await recordReconciledOrderState(
        ownerId,
        id,
        PaymentAttemptStatus.FAILED,
        order.status,
        'PAYMENT_RECONCILIATION_VOIDED',
        'PAYPAL_ORDER_VOIDED',
      );
      return { ...attemptResponse(current), processing: attemptIsProcessing(current.status) };
    }
    case 'COMPLETED':
      break;
    default: {
      const current = await recordReconciledOrderState(
        ownerId,
        id,
        PaymentAttemptStatus.AMBIGUOUS,
        order.status,
        'PAYMENT_RECONCILIATION_UNRESOLVED',
        'UNEXPECTED_PROVIDER_STATUS',
      );
      return { ...attemptResponse(current), processing: attemptIsProcessing(current.status) };
    }
  }

  const capture = verifiedOrderCapture(order, {
    totalAmount: attempt.amount,
    currency: attempt.currency,
  });
  if (!capture) {
    const current = await recordReconciledOrderState(
      ownerId,
      id,
      PaymentAttemptStatus.AMBIGUOUS,
      order.status,
      'PAYMENT_RECONCILIATION_UNRESOLVED',
      'UNVERIFIED_CAPTURE_DETAILS',
    );
    return { ...attemptResponse(current), processing: attemptIsProcessing(current.status) };
  }
  const verified = { capture, status: PaymentAttemptStatus.SUCCEEDED };

  const reconciled = await withPaymentPlanTransaction(async (transaction) => {
    const current = await findPaymentAttemptInTransaction(transaction, ownerId, id);
    if (!current) throw ownedAttemptError();
    if (current.status === PaymentAttemptStatus.SUCCEEDED) return current;
    if (
      current.status !== PaymentAttemptStatus.AMBIGUOUS &&
      current.status !== PaymentAttemptStatus.PENDING &&
      current.status !== PaymentAttemptStatus.CAPTURING
    ) {
      throw new HttpError(
        'Payment attempt changed while reconciliation was in progress.',
        409,
        'PAYMENT_ATTEMPT_CHANGED',
      );
    }

    const update = await updatePaymentAttempt(
      transaction,
      ownerId,
      id,
      [
        PaymentAttemptStatus.AMBIGUOUS,
        PaymentAttemptStatus.PENDING,
        PaymentAttemptStatus.CAPTURING,
      ],
      {
        status: verified.status,
        providerCaptureId: verified.capture.id,
        providerStatus: verified.capture.status,
        providerErrorCode: null,
      },
    );
    if (update.count !== 1) {
      throw new HttpError(
        'Payment attempt changed while reconciliation was in progress.',
        409,
        'PAYMENT_ATTEMPT_CHANGED',
      );
    }

    if (verified.status === PaymentAttemptStatus.SUCCEEDED) {
      const allocationSum = current.invoiceAllocations.reduce(
        (total, item) => total + item.amount,
        0,
      );
      const allocationsMatch =
        allocationSum === current.amount &&
        current.invoiceAllocations.every((item) => item.currency === current.currency);
      const invoiceIds = current.invoiceAllocations.map(({ invoiceId }) => invoiceId);
      const invoices = await findInvoicesForPaymentPlan(transaction, ownerId, invoiceIds);
      const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      const invoiceVersionsMatch =
        invoices.length === current.invoiceAllocations.length &&
        current.invoiceAllocations.every((allocation) => {
          const invoice = invoicesById.get(allocation.invoiceId);
          return (
            invoice !== undefined &&
            invoice.amount === allocation.amount &&
            invoice.currency === allocation.currency &&
            (invoice.status === InvoiceStatus.PENDING || invoice.status === InvoiceStatus.OVERDUE)
          );
        });
      if (!allocationsMatch || !invoiceVersionsMatch) {
        await createPaymentAttemptAuditEvent(transaction, {
          ownerId,
          eventType: 'PAYMENT_CAPTURE_INVOICE_CONFLICT',
          entityId: id,
          metadata: {
            paypalOrderId: current.providerOrderId ?? undefined,
            captureId: verified.capture.id,
            reason: !allocationsMatch ? 'ALLOCATION_MISMATCH' : 'INVOICE_VERSION_CHANGED',
          },
        });
      } else {
        const paid = await updateAttemptInvoicesAsPaid(transaction, ownerId, invoiceIds);
        if (paid.count !== invoiceIds.length) {
          await createPaymentAttemptAuditEvent(transaction, {
            ownerId,
            eventType: 'PAYMENT_CAPTURE_INVOICE_CONFLICT',
            entityId: id,
            metadata: {
              paypalOrderId: current.providerOrderId ?? undefined,
              captureId: verified.capture.id,
              expectedInvoiceCount: invoiceIds.length,
              updatedInvoiceCount: paid.count,
            },
          });
        }
      }
    }

    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType:
        verified.status === PaymentAttemptStatus.SUCCEEDED
          ? 'PAYMENT_RECONCILIATION_SUCCEEDED'
          : verified.status === PaymentAttemptStatus.DECLINED
            ? 'PAYMENT_RECONCILIATION_DECLINED'
            : 'PAYMENT_RECONCILIATION_PENDING',
      entityId: id,
      metadata: {
        paypalOrderId: current.providerOrderId ?? undefined,
        captureId: verified.capture.id,
        providerStatus: verified.capture.status,
        amount: current.amount,
        currency: current.currency,
      },
    });
    const reloaded = await findPaymentAttemptInTransaction(transaction, ownerId, id);
    if (!reloaded) throw ownedAttemptError();
    return reloaded;
  });

  return {
    ...attemptResponse(reconciled),
    processing: reconciled.status === PaymentAttemptStatus.PENDING,
  };
}

export async function cancelPayPalAttempt(ownerId: string, id: string) {
  const result = await withPaymentPlanTransaction(async (transaction) => {
    const attempt = await findPaymentAttemptInTransaction(transaction, ownerId, id);
    if (!attempt) return { error: ownedAttemptError() };
    if (attempt.status === PaymentAttemptStatus.CANCELLED) return { attempt };
    if (attempt.status !== PaymentAttemptStatus.PENDING || attempt.providerStatus !== 'CREATED') {
      return {
        error: new HttpError(
          'This payment attempt can no longer be cancelled.',
          409,
          'INVALID_PAYMENT_ATTEMPT_STATE',
        ),
      };
    }
    const update = await updatePaymentAttempt(
      transaction,
      ownerId,
      id,
      [PaymentAttemptStatus.PENDING],
      { status: PaymentAttemptStatus.CANCELLED },
    );
    if (update.count !== 1) {
      return {
        error: new HttpError(
          'Payment attempt changed; refresh its status.',
          409,
          'PAYMENT_ATTEMPT_CHANGED',
        ),
      };
    }
    const cancelled = await findPaymentAttemptInTransaction(transaction, ownerId, id);
    if (!cancelled) throw ownedAttemptError();
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_ATTEMPT_CANCELLED',
      entityId: id,
      metadata: {
        paypalOrderId: cancelled.providerOrderId ?? undefined,
        paymentPlanId: cancelled.paymentPlanId ?? undefined,
      },
    });
    return { attempt: cancelled };
  });
  if (result.error) throw result.error;
  if (!result.attempt) throw ownedAttemptError();
  return attemptResponse(result.attempt);
}

async function claimCapture(ownerId: string, attemptId: string, now: Date) {
  return withPaymentPlanTransaction(async (transaction) => {
    const attempt = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!attempt) return { error: ownedAttemptError() };
    if (attempt.status === PaymentAttemptStatus.SUCCEEDED)
      return { attempt, alreadySucceeded: true };
    if (attempt.status === PaymentAttemptStatus.CAPTURING) {
      const recoverBefore = new Date(now.getTime() - CAPTURE_REQUEST_TIMEOUT_RECOVERY_MS);
      if (attempt.updatedAt >= recoverBefore) return { attempt, inProgress: true };
    }
    if (
      attempt.status !== PaymentAttemptStatus.PENDING &&
      attempt.status !== PaymentAttemptStatus.AMBIGUOUS &&
      attempt.status !== PaymentAttemptStatus.CAPTURING
    ) {
      return {
        error: new HttpError(
          'This payment attempt cannot be captured.',
          409,
          'INVALID_PAYMENT_ATTEMPT_STATE',
        ),
      };
    }
    if (!attempt.providerOrderId || !attempt.paymentPlanId) {
      return {
        error: new HttpError(
          'PayPal order is not available for this attempt.',
          409,
          'PAYPAL_ORDER_REQUIRED',
        ),
      };
    }

    const updated = await transaction.paymentAttempt.updateMany({
      where: {
        id: attemptId,
        ownerId,
        providerOrderId: attempt.providerOrderId,
        OR: [
          { status: { in: [PaymentAttemptStatus.PENDING, PaymentAttemptStatus.AMBIGUOUS] } },
          {
            status: PaymentAttemptStatus.CAPTURING,
            updatedAt: { lt: new Date(now.getTime() - CAPTURE_REQUEST_TIMEOUT_RECOVERY_MS) },
          },
        ],
      },
      data: {
        status: PaymentAttemptStatus.CAPTURING,
        providerErrorCode: null,
      },
    });
    if (updated.count !== 1) {
      const current = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
      if (current?.status === PaymentAttemptStatus.SUCCEEDED) {
        return { attempt: current, alreadySucceeded: true };
      }
      return {
        attempt: current ?? attempt,
        inProgress: true,
      };
    }
    const claimed = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!claimed) throw ownedAttemptError();
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType: 'PAYMENT_CAPTURE_STARTED',
      entityId: attemptId,
      metadata: {
        paypalOrderId: claimed.providerOrderId ?? undefined,
        paymentPlanId: claimed.paymentPlanId ?? undefined,
      },
    });
    return { attempt: claimed, claimed: true };
  });
}

export async function capturePayPalAttempt(
  ownerId: string,
  attemptId: string,
  browserOrderId: string,
  provider: PayPalPaymentProvider = defaultProvider,
  now = new Date(),
) {
  const initial = await getPaymentAttempt(ownerId, attemptId);
  if (initial.paypalOrderId !== browserOrderId) {
    throw new HttpError(
      'PayPal order does not match this payment attempt.',
      409,
      'PAYPAL_ORDER_MISMATCH',
    );
  }
  if (initial.status === PaymentAttemptStatus.SUCCEEDED) {
    return { ...initial, processing: false };
  }
  if (!initial.paymentPlanId) {
    throw new HttpError('Payment plan not found.', 409, 'INVALID_PAYMENT_ATTEMPT');
  }
  const authorization = await verifyApprovedPaymentPlanForExecution(
    ownerId,
    initial.paymentPlanId,
    now,
  );
  if (
    authorization.totalAmount !== initial.amountMinor ||
    authorization.currency !== initial.currency ||
    authorization.invoiceIds.length !== initial.invoiceIds.length ||
    authorization.invoiceIds.some((id) => !initial.invoiceIds.includes(id))
  ) {
    throw new HttpError(
      'Payment attempt no longer matches its approved plan.',
      409,
      'PAYMENT_PLAN_STALE',
    );
  }

  const claim = await claimCapture(ownerId, attemptId, now);
  if (claim.error) throw claim.error;
  if (!claim.attempt) throw ownedAttemptError();
  if (claim.alreadySucceeded) return { ...attemptResponse(claim.attempt), processing: false };
  if (claim.inProgress) return { ...attemptResponse(claim.attempt), processing: true };
  const attempt = claim.attempt;
  if (!attempt.providerOrderId || !attempt.paymentPlanId) throw ownedAttemptError();

  let providerResult: unknown;
  try {
    providerResult = await provider.captureOrder({
      orderId: attempt.providerOrderId,
      requestId: providerRequestId('capture', authorization.proposalVersion),
    });
  } catch (error) {
    const failure =
      error instanceof PayPalProviderError
        ? error
        : new PayPalProviderError('PayPal capture outcome is uncertain.', 'ambiguous');
    const status =
      failure.certainty === 'ambiguous'
        ? PaymentAttemptStatus.AMBIGUOUS
        : failure.providerCode === 'INSTRUMENT_DECLINED' ||
            failure.providerCode === 'PAYMENT_DENIED'
          ? PaymentAttemptStatus.DECLINED
          : PaymentAttemptStatus.FAILED;
    const event =
      status === PaymentAttemptStatus.AMBIGUOUS
        ? 'PAYMENT_CAPTURE_AMBIGUOUS'
        : status === PaymentAttemptStatus.DECLINED
          ? 'PAYMENT_CAPTURE_DECLINED'
          : 'PAYMENT_CAPTURE_FAILED';
    await recordAttemptState(
      ownerId,
      attemptId,
      [PaymentAttemptStatus.CAPTURING],
      status,
      event,
      { providerErrorCode: failure.providerCode },
      failure.certainty === 'ambiguous' ? 'CAPTURE_OUTCOME_UNKNOWN' : undefined,
      failure.providerCode,
    );
    throwProviderFailure(failure, 'capture', attemptId);
  }

  const parsed = paypalCaptureResponseSchema.safeParse(providerResult);
  const purchaseUnit = parsed.success ? parsed.data.purchase_units[0] : undefined;
  const capture = purchaseUnit?.payments.captures[0];
  if (
    !parsed.success ||
    !purchaseUnit ||
    !capture ||
    parsed.data.id !== attempt.providerOrderId ||
    purchaseUnit.reference_id !== attempt.id ||
    purchaseUnit.custom_id !== attempt.id ||
    purchaseUnit.amount.currency_code !== attempt.currency ||
    purchaseUnit.amount.value !== minorUnitsToAmount(attempt.amount, attempt.currency) ||
    capture.amount.currency_code !== attempt.currency ||
    capture.amount.value !== minorUnitsToAmount(attempt.amount, attempt.currency)
  ) {
    await recordAttemptState(
      ownerId,
      attemptId,
      [PaymentAttemptStatus.CAPTURING],
      PaymentAttemptStatus.AMBIGUOUS,
      'PAYMENT_CAPTURE_RESPONSE_UNEXPECTED',
      {},
      'UNRECOGNIZED_CAPTURE_RESPONSE',
    );
    throw new HttpError(
      'PayPal returned an unexpected capture response. The outcome is uncertain; check the payment attempt.',
      502,
      'PAYPAL_UNEXPECTED_RESPONSE',
    );
  }

  const resultingStatus =
    parsed.data.status === 'COMPLETED' && capture.status === 'COMPLETED'
      ? PaymentAttemptStatus.SUCCEEDED
      : parsed.data.status === 'PENDING' && capture.status === 'PENDING'
        ? PaymentAttemptStatus.PENDING
        : parsed.data.status === 'DECLINED' && capture.status === 'DECLINED'
          ? PaymentAttemptStatus.DECLINED
          : PaymentAttemptStatus.AMBIGUOUS;

  const updated = await withPaymentPlanTransaction(async (transaction) => {
    const current = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!current) throw ownedAttemptError();
    if (current.status === PaymentAttemptStatus.SUCCEEDED) return current;
    if (current.status !== PaymentAttemptStatus.CAPTURING) {
      throw new HttpError(
        'Payment attempt changed while capture was in progress.',
        409,
        'PAYMENT_ATTEMPT_CHANGED',
      );
    }
    const update = await updatePaymentAttempt(
      transaction,
      ownerId,
      attemptId,
      [PaymentAttemptStatus.CAPTURING],
      {
        status: resultingStatus,
        providerCaptureId: capture.id,
        providerStatus: capture.status,
        providerErrorCode:
          resultingStatus === PaymentAttemptStatus.AMBIGUOUS ? 'UNEXPECTED_PROVIDER_STATUS' : null,
      },
    );
    if (update.count !== 1) {
      throw new HttpError(
        'Payment attempt changed while capture was in progress.',
        409,
        'PAYMENT_ATTEMPT_CHANGED',
      );
    }
    if (resultingStatus === PaymentAttemptStatus.SUCCEEDED) {
      const allocationSum = current.invoiceAllocations.reduce(
        (total, item) => total + item.amount,
        0,
      );
      const allocationsMatch =
        allocationSum === current.amount &&
        current.invoiceAllocations.every((item) => item.currency === current.currency);
      const allocatedInvoices = await findInvoicesForPaymentPlan(
        transaction,
        ownerId,
        current.invoiceAllocations.map(({ invoiceId }) => invoiceId),
      );
      const byInvoiceId = new Map(allocatedInvoices.map((invoice) => [invoice.id, invoice]));
      const invoiceVersionsMatch =
        allocatedInvoices.length === current.invoiceAllocations.length &&
        current.invoiceAllocations.every((allocation) => {
          const invoice = byInvoiceId.get(allocation.invoiceId);
          return (
            invoice !== undefined &&
            invoice.amount === allocation.amount &&
            invoice.currency === allocation.currency &&
            (invoice.status === InvoiceStatus.PENDING || invoice.status === InvoiceStatus.OVERDUE)
          );
        });
      if (!allocationsMatch || !invoiceVersionsMatch) {
        await createPaymentAttemptAuditEvent(transaction, {
          ownerId,
          eventType: 'PAYMENT_CAPTURE_INVOICE_CONFLICT',
          entityId: attemptId,
          metadata: {
            paypalOrderId: current.providerOrderId ?? undefined,
            captureId: capture.id,
            reason: !allocationsMatch ? 'ALLOCATION_MISMATCH' : 'INVOICE_VERSION_CHANGED',
          },
        });
      } else {
        const invoiceIds = current.invoiceAllocations.map(({ invoiceId }) => invoiceId);
        const paid = await updateAttemptInvoicesAsPaid(transaction, ownerId, invoiceIds);
        if (paid.count !== invoiceIds.length) {
          await createPaymentAttemptAuditEvent(transaction, {
            ownerId,
            eventType: 'PAYMENT_CAPTURE_INVOICE_CONFLICT',
            entityId: attemptId,
            metadata: {
              paypalOrderId: current.providerOrderId ?? undefined,
              captureId: capture.id,
              expectedInvoiceCount: invoiceIds.length,
              updatedInvoiceCount: paid.count,
            },
          });
        }
      }
    }
    await createPaymentAttemptAuditEvent(transaction, {
      ownerId,
      eventType:
        resultingStatus === PaymentAttemptStatus.SUCCEEDED
          ? 'PAYMENT_CAPTURE_SUCCEEDED'
          : resultingStatus === PaymentAttemptStatus.DECLINED
            ? 'PAYMENT_CAPTURE_DECLINED'
            : resultingStatus === PaymentAttemptStatus.PENDING
              ? 'PAYMENT_CAPTURE_PENDING'
              : 'PAYMENT_CAPTURE_AMBIGUOUS',
      entityId: attemptId,
      metadata: {
        paypalOrderId: current.providerOrderId ?? undefined,
        captureId: capture.id,
        providerStatus: capture.status,
        amount: current.amount,
        currency: current.currency,
      },
    });
    const reloaded = await findPaymentAttemptInTransaction(transaction, ownerId, attemptId);
    if (!reloaded) throw ownedAttemptError();
    return reloaded;
  });

  if (resultingStatus === PaymentAttemptStatus.DECLINED) {
    throw new HttpError(
      'PayPal declined this payment. No successful capture was recorded.',
      402,
      'PAYMENT_DECLINED',
    );
  }
  if (resultingStatus === PaymentAttemptStatus.AMBIGUOUS) {
    throw new HttpError(
      'PayPal returned a non-final capture status. Check the attempt before retrying.',
      503,
      'PAYMENT_CAPTURE_AMBIGUOUS',
    );
  }
  return {
    ...attemptResponse(updated),
    processing: resultingStatus === PaymentAttemptStatus.PENDING,
  };
}

export async function getPayPalConfiguration() {
  return getPayPalSandboxConfiguration();
}
