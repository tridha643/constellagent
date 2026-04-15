import { beforeEach, describe, expect, it } from 'bun:test'
import { requestAppRelaunch, resetAppRelaunchForTests } from './app-relaunch'

describe('requestAppRelaunch', () => {
  beforeEach(() => {
    resetAppRelaunchForTests()
  })

  it('relaunches before quitting the app', () => {
    const calls: string[] = []

    const requested = requestAppRelaunch({
      relaunch: () => {
        calls.push('relaunch')
      },
      quit: () => {
        calls.push('quit')
      },
    })

    expect(requested).toBe(true)
    expect(calls).toEqual(['relaunch', 'quit'])
  })

  it('ignores duplicate relaunch requests', () => {
    let relaunchCount = 0
    let quitCount = 0

    const target = {
      relaunch: () => {
        relaunchCount += 1
      },
      quit: () => {
        quitCount += 1
      },
    }

    expect(requestAppRelaunch(target)).toBe(true)
    expect(requestAppRelaunch(target)).toBe(false)
    expect(relaunchCount).toBe(1)
    expect(quitCount).toBe(1)
  })
})
