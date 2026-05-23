import { describe, expect, it } from 'bun:test'
import { withCursorSdkModelValidationBypass } from './cursor-model-catalog'

describe('withCursorSdkModelValidationBypass', () => {
  it('sets a scoped global bypass flag without clearing CURSOR_API_KEY', async () => {
    const previousKey = process.env.CURSOR_API_KEY
    const previousFlag = globalThis.__constellagentCursorBypassModelValidation
    process.env.CURSOR_API_KEY = 'cursor_test_key'
    delete globalThis.__constellagentCursorBypassModelValidation

    try {
      await withCursorSdkModelValidationBypass(true, async () => {
        expect(globalThis.__constellagentCursorBypassModelValidation).toBe(true)
        expect(process.env.CURSOR_API_KEY).toBe('cursor_test_key')
      })

      expect(globalThis.__constellagentCursorBypassModelValidation).toBeUndefined()
      expect(process.env.CURSOR_API_KEY).toBe('cursor_test_key')
    } finally {
      if (previousKey === undefined) delete process.env.CURSOR_API_KEY
      else process.env.CURSOR_API_KEY = previousKey

      if (previousFlag === undefined) delete globalThis.__constellagentCursorBypassModelValidation
      else globalThis.__constellagentCursorBypassModelValidation = previousFlag
    }
  })
})
