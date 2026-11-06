// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeRpcCallQueuePool } from '../../../../shared/runtime-rpc-call-queue'
import { callGitHubAttachmentRpc } from '@/runtime/github-attachment-rpc'

const state = vi.hoisted(() => ({
  environment: { id: 'image-env', createdAt: 1 },
  subscribe: vi.fn()
}))
vi.mock('./web-runtime-session', async () => {
  const { RuntimeRpcCallQueuePool } = await import('../../../../shared/runtime-rpc-call-queue')
  return {
    runtimeCallQueuePool: new RuntimeRpcCallQueuePool(1),
    getClientForEnvironment: () => ({ subscribe: state.subscribe }),
    requireActiveEnvironment: () => state.environment,
    requireActiveEnvironmentOrNull: () => state.environment,
    resolveEnvironment: () => state.environment,
    manuallyDisconnectedEnvironmentIds: new Set(),
    updateEnvironmentFromResponse: vi.fn(),
    subscribeWebRuntimeStatus: vi.fn(),
    readWebRuntimeStatusSnapshots: vi.fn(),
    closeActiveRuntimeClients: vi.fn(),
    disconnectActiveRuntimeEnvironment: vi.fn(),
    removeActiveRuntimeEnvironment: vi.fn(),
    manuallyDisconnectedResponse: vi.fn(),
    webRuntimeState: {}
  }
})
import { runtimeCallQueuePool } from './web-runtime-session'
import { createWebRuntimeApi } from './web-runtime-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('cancels web-local image work while the production presend queue is occupied, then permits a successor', async () => {
  expect(runtimeCallQueuePool).toBeInstanceOf(RuntimeRpcCallQueuePool)
  const busy = Promise.withResolvers<void>()
  const blocker = runtimeCallQueuePool.enqueue('image-env', 'files.write', () => busy.promise)
  const runtime = createWebRuntimeApi()
  vi.stubGlobal('api', { runtime })
  const controller = new AbortController()
  const pending = callGitHubAttachmentRpc(
    { kind: 'local' },
    'github.uploadAttachment',
    { uploadId: 'old' },
    controller.signal,
    135_000
  )
  const cancelled = expect(pending).rejects.toThrow('interrupted')
  controller.abort()
  await cancelled
  busy.resolve()
  await blocker
  await Promise.resolve()
  expect(state.subscribe).not.toHaveBeenCalled()
  const unsubscribe = vi.fn()
  state.subscribe.mockImplementation(async (_method, _params, callbacks) => {
    callbacks.onResponse({
      id: 'next',
      ok: true,
      result: { url: 'https://github.com/user-attachments/assets/next' }
    })
    return { unsubscribe }
  })
  await expect(
    callGitHubAttachmentRpc(
      { kind: 'local' },
      'github.uploadAttachment',
      { uploadId: 'next' },
      new AbortController().signal,
      135_000
    )
  ).resolves.toEqual({ url: 'https://github.com/user-attachments/assets/next' })
  await Promise.resolve()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
