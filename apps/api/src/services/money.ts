export function minorUnitsToAmount(amountMinor: number, currency: string) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError('Amount must be a non-negative safe integer in minor units.')
  }
  const fractionDigits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2
  return (amountMinor / 10 ** fractionDigits).toFixed(fractionDigits)
}
