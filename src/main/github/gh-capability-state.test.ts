import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ghExecFileAsyncMock } = vi.hoisted(() => ({
  ghExecFileAsyncMock: vi.fn()
}))

vi.mock('../git/command-runner/gh-exec-file', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ghExecFileAsync: ghExecFileAsyncMock
}))

import {
  clearGhCapabilityStateForTests,
  getGhMultiAccountCapability,
  invalidateGhMultiAccountCapability
} from './gh-capability-state'

describe('gh-capability-state', () => {
  beforeEach(() => {
    clearGhCapabilityStateForTests()
    ghExecFileAsyncMock.mockReset()
  })

  afterEach(() => {
    clearGhCapabilityStateForTests()
  })

  it('cancels only one shared probe waiter and preserves the result for other callers', async () => {
    let finish!: (value: { stdout: string; stderr: string }) => void
    ghExecFileAsyncMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const controller = new AbortController()
    const cancelled = getGhMultiAccountCapability({ signal: controller.signal })
    const other = getGhMultiAccountCapability()
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejection
    finish({ stdout: 'Usage: gh auth token [--user login]', stderr: '' })
    await expect(other).resolves.toBe('supported')
    await expect(getGhMultiAccountCapability()).resolves.toBe('supported')
    expect(ghExecFileAsyncMock).toHaveBeenCalledOnce()
  })

  it('caches per runtime and invalidates on request', async () => {
    ghExecFileAsyncMock.mockResolvedValue({
      stdout: 'Usage: gh auth token [--user login]',
      stderr: ''
    })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(1)

    invalidateGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})
