import { afterEach, describe, expect, it } from 'bun:test'
import { hasRequiredChicagoSubscriptionForSession } from './gates.js'

const originalBuildMode = process.env.NCODE_BUILD_MODE
const originalUserType = process.env.USER_TYPE

afterEach(() => {
  if (originalBuildMode === undefined) {
    delete process.env.NCODE_BUILD_MODE
  } else {
    process.env.NCODE_BUILD_MODE = originalBuildMode
  }

  if (originalUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalUserType
  }
})

describe('computer use canonical session helpers', () => {
  it('allows only max and pro sessions by default', () => {
    delete process.env.NCODE_BUILD_MODE
    delete process.env.USER_TYPE

    expect(
      hasRequiredChicagoSubscriptionForSession({
        subscription: {
          subscriptionType: 'max',
        },
      } as any),
    ).toBe(true)

    expect(
      hasRequiredChicagoSubscriptionForSession({
        subscription: {
          subscriptionType: 'pro',
        },
      } as any),
    ).toBe(true)

    expect(
      hasRequiredChicagoSubscriptionForSession({
        subscription: {
          subscriptionType: 'team',
        },
      } as any),
    ).toBe(false)

    expect(hasRequiredChicagoSubscriptionForSession(null)).toBe(false)
  })

  it('preserves ant bypass behavior', () => {
    process.env.NCODE_BUILD_MODE = 'noumena'
    process.env.USER_TYPE = 'ant'
    expect(hasRequiredChicagoSubscriptionForSession(null)).toBe(true)
  })
})
