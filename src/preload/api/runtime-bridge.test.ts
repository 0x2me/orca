import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeApi } from './runtime-bridge'

const { ipc } = vi.hoisted(() => ({
  ipc: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}))

vi.mock('electron', () => ({ ipcRenderer: ipc }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('local runtime subscription identity', () => {
  it.each([
    { subscriptionId: undefined, expected: 'desktop-00000000-0000-4000-8000-000000000001' },
    { subscriptionId: 'draft-observation', expected: 'draft-observation' }
  ])(
    'uses one resolved identity for delivery and cancellation ($subscriptionId)',
    async (input) => {
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
      ipc.invoke.mockResolvedValue({ subscribed: true })

      const subscription = await runtimeApi.subscribe(
        { method: 'repo.show', params: { repoId: 'repo-1' }, subscriptionId: input.subscriptionId },
        vi.fn()
      )

      expect(ipc.on).toHaveBeenCalledWith(
        `runtime:subscription:${input.expected}`,
        expect.any(Function)
      )
      expect(ipc.invoke).toHaveBeenCalledWith('runtime:subscribe', {
        method: 'repo.show',
        params: { repoId: 'repo-1' },
        subscriptionId: input.expected
      })

      subscription.unsubscribe()
      expect(ipc.send).toHaveBeenCalledWith('runtime:unsubscribe', {
        subscriptionId: input.expected
      })
    }
  )
})
