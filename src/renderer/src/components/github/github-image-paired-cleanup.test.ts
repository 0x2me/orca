import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/runtime-environment-revision'
import { clearRuntimeCompatibilityCacheForTests } from '@/runtime/runtime-rpc-client'
import { createCompatibleRuntimeStatusResponse } from '@/runtime/runtime-compatibility-test-fixture'
import { BrowserImageParserFixture } from '../../../../shared/github/__fixtures__/image-parser-worker-fixture'
import { addIssueCommentForRepo } from './github-work-item-comment-mutations'

const original = useAppStore.getState()
beforeEach(() => {
  vi.stubGlobal('Worker', BrowserImageParserFixture)
  clearRuntimeCompatibilityCacheForTests()
  replaceRuntimeEnvironmentRevisions([{ id: 'paired', createdAt: 7 }])
  useAppStore.setState({ repos: [] })
})
afterEach(() => {
  replaceRuntimeEnvironmentRevisions([])
  clearRuntimeCompatibilityCacheForTests()
  useAppStore.setState(original, true)
  vi.unstubAllGlobals()
})

it.each(['original', 'replaced'] as const)(
  'cleans up cancelled staging only on the %s paired server through real RPC dispatch',
  async (pairing) => {
    const started = Promise.withResolvers<void>()
    const controller = new AbortController()
    const update = vi.fn()
    const sent: { method: string; [key: string]: unknown }[] = []
    const status = createCompatibleRuntimeStatusResponse('original-runtime')
    const subscribe = vi.fn(async (request, handlers) => {
      sent.push(request)
      if (request.method === 'clipboard.appendImageUploadChunk') {
        started.resolve()
        return { unsubscribe: vi.fn(), sendBinary: vi.fn() }
      }
      const result =
        request.method === 'status.get'
          ? status
          : {
              id: request.subscriptionId,
              ok: true,
              result:
                request.method === 'repo.show'
                  ? {
                      githubAttachmentSelection: {
                        id: 'repo',
                        path: '/repo',
                        issueSourcePreference: 'auto',
                        connectionId: null,
                        executionHostId: 'local',
                        wslDistro: null,
                        ghAccount: null
                      }
                    }
                  : request.method === 'clipboard.startImageUpload'
                    ? { uploadId: 'cancelled-stage' }
                    : {},
              _meta: { runtimeId: 'original-runtime' }
            }
      handlers.onResponse(result)
      return { unsubscribe: vi.fn(), sendBinary: vi.fn() }
    })
    vi.stubGlobal('window', {
      api: {
        runtimeEnvironments: {
          call: vi.fn(async (request) => {
            expect(request.method).toBe('status.get')
            return status
          }),
          subscribe,
          cancelSubscription: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
    const pending = addIssueCommentForRepo({
      repoId: 'repo',
      repoPath: '/repo',
      number: 42,
      sourceContext: {
        kind: 'task-source',
        provider: 'github',
        hostId: 'runtime:paired',
        projectId: 'project',
        repoId: 'repo'
      },
      body: '![image](data:image/png;base64,AA==)',
      preparation: { signal: controller.signal, update }
    })
    const rejection = expect(pending).rejects.toThrow()
    await started.promise
    if (pairing === 'replaced') {
      replaceRuntimeEnvironmentRevisions([{ id: 'paired', createdAt: 8 }])
    }
    controller.abort()
    await rejection
    expect(sent.map(({ method }) => method)).toEqual([
      'status.get',
      'repo.show',
      'clipboard.startImageUpload',
      'clipboard.appendImageUploadChunk',
      ...(pairing === 'original' ? ['clipboard.abortImageUpload'] : [])
    ])
    if (pairing === 'original') {
      expect(sent.at(-1)).toMatchObject({
        selector: 'paired',
        method: 'clipboard.abortImageUpload',
        params: { uploadId: 'cancelled-stage' },
        timeoutMs: 5_000,
        expectedEnvironmentPairingRevision: 7,
        expectedEnvironmentRuntimeId: 'original-runtime'
      })
    }
    expect(update).not.toHaveBeenCalled()
  }
)
