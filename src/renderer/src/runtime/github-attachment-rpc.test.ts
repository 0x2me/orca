import { afterEach, expect, it, vi } from 'vitest'
import { callGitHubAttachmentRpc } from './github-attachment-rpc'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('cancels a local preparation before its subscription handle arrives and disposes the late handle', async () => {
  let finish!: (handle: { unsubscribe: () => void }) => void
  const subscribe = vi.fn(
    (_args: { subscriptionId: string }) =>
      new Promise<{ unsubscribe: () => void }>((resolve) => {
        finish = resolve
      })
  )
  const cancel = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: { runtime: { subscribe, cancelSubscription: cancel } } })
  const controller = new AbortController()
  const request = callGitHubAttachmentRpc(
    { kind: 'local' },
    'github.uploadAttachment',
    { uploadId: 'image' },
    controller.signal,
    135_000
  )
  const rejection = expect(request).rejects.toThrow('interrupted')
  controller.abort()
  await rejection
  expect(cancel).toHaveBeenCalledWith({ subscriptionId: subscribe.mock.calls[0][0].subscriptionId })
  const unsubscribe = vi.fn()
  finish({ unsubscribe })
  await Promise.resolve()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('expires local waiting and cancels the host request instead of leaving queued upload work live', async () => {
  vi.useFakeTimers()
  const unsubscribe = vi.fn()
  vi.stubGlobal('window', {
    api: {
      runtime: {
        subscribe: vi.fn().mockResolvedValue({ unsubscribe }),
        cancelSubscription: vi.fn().mockResolvedValue(undefined)
      }
    }
  })
  const request = callGitHubAttachmentRpc(
    { kind: 'local' },
    'github.uploadAttachment',
    {},
    new AbortController().signal,
    135_000
  )
  const rejection = expect(request).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(135_001)
  await rejection
  expect(unsubscribe).toHaveBeenCalledOnce()
})
