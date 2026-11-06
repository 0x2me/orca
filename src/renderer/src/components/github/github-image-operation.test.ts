import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { BrowserImageParserFixture } from '../../../../shared/github/__fixtures__/image-parser-worker-fixture'
import { makeRepo } from '../worktree-jump/worktree-jump-palette-test-fixtures'
import { gitHubRepoImageContext } from './github-image-operation'
import { addIssueCommentForRepo } from './github-work-item-comment-mutations'

const mocks = vi.hoisted(() => ({ attachment: vi.fn(), final: vi.fn() }))
vi.mock('@/runtime/github-attachment-rpc', () => ({ callGitHubAttachmentRpc: mocks.attachment }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.final }))
const original = useAppStore.getState()
beforeEach(() => {
  vi.stubGlobal('Worker', BrowserImageParserFixture)
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    api: { gh: { notifyWorkItemMutated: vi.fn().mockResolvedValue(undefined) } }
  })
  mocks.attachment.mockReset()
  mocks.final.mockReset().mockResolvedValue({ ok: true, comment: { id: 42 } })
})
afterEach(() => {
  useAppStore.setState(original, true)
  vi.unstubAllGlobals()
})

it.each(['focus', 'binding'] as const)(
  'uses the preflight-selected nested route through an awaited upload after %s changes',
  async (change) => {
    const local = { ...makeRepo(), id: 'repo', path: '/repo', connectionId: 'selected' }
    const twin = { ...local, connectionId: 'other' }
    const remote = { ...local, executionHostId: 'runtime:elsewhere' as const }
    useAppStore.setState({ repos: [local, twin, remote] })
    const uploaded = Promise.withResolvers<{ url: string; preparationId: string }>()
    const started = Promise.withResolvers<void>()
    mocks.attachment.mockImplementation(async (_target, method) => {
      if (method === 'status.get') {
        return { capabilities: ['github.image-attachments.v1'] }
      }
      if (method === 'repo.show') {
        return {
          githubAttachmentSelection: {
            id: 'repo',
            path: '/repo',
            issueSourcePreference: 'auto',
            connectionId: 'selected',
            executionHostId: 'ssh:selected',
            wslDistro: null,
            ghAccount: null
          }
        }
      }
      if (method === 'clipboard.startImageUpload') {
        return { uploadId: 'stage' }
      }
      if (method === 'github.uploadAttachment') {
        started.resolve()
        return uploaded.promise
      }
      return {}
    })
    const args = { repoId: 'repo', repoPath: '/repo', number: 42 }
    const context = gitHubRepoImageContext(args, 'issue')
    const update = vi.fn()
    const pending = addIssueCommentForRepo({
      ...args,
      body: '![one](data:image/png;base64,AA==)\n![two](data:image/png;base64,AQ==)',
      preparation: { context, signal: new AbortController().signal, update }
    })
    // Attach the rejection assertion before publishing the owner change.
    const result =
      change === 'binding'
        ? expect(pending).rejects.toThrow('destination changed')
        : expect(pending).resolves.toMatchObject({ ok: true })
    await started.promise
    useAppStore.setState(
      change === 'focus'
        ? {
            settings: { ...original.settings!, activeRuntimeEnvironmentId: 'elsewhere' },
            repos: [local, twin, { ...remote }]
          }
        : {
            repos: [{ ...local, ghAccount: { host: 'github.com', user: 'changed' } }, twin, remote]
          }
    )
    uploaded.resolve({
      url: 'https://github.com/user-attachments/assets/screen',
      preparationId: 'prepared'
    })
    await result
    if (change === 'binding') {
      expect(update).not.toHaveBeenCalled()
      expect(mocks.final).not.toHaveBeenCalled()
      expect(
        mocks.attachment.mock.calls.filter(([, method]) => method === 'clipboard.startImageUpload')
      ).toHaveLength(1)
    } else {
      expect(mocks.final).toHaveBeenCalledWith(
        { kind: 'local' },
        'github.addIssueComment',
        expect.objectContaining({
          repo: 'repo',
          body: '![one](https://github.com/user-attachments/assets/screen)\n![two](https://github.com/user-attachments/assets/screen)'
        }),
        expect.anything()
      )
      expect(update).toHaveBeenCalledTimes(2)
    }
  }
)
