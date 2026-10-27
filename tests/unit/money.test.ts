import { describe, expect, it } from 'vitest'
import { minorUnitsToAmount } from '../../apps/api/src/services/money.js'

describe('minorUnitsToAmount', () => {
  it.each([
    [12_345, 'USD', '123.45'],
    [500, 'EUR', '5.00'],
    [12_345, 'JPY', '12345'],
    [1_234, 'KWD', '1.234'],
  ])('formats %i minor units as %s', (amount, currency, expected) => {
    expect(minorUnitsToAmount(amount, currency)).toBe(expected)
  })

  it.each([-1, 1.25, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid minor-unit value %s',
    (amount) => {
      expect(() => minorUnitsToAmount(amount, 'USD')).toThrow(RangeError)
    },
  )
})
