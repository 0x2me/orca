import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GhUtils from '../../../github/gh-utils'
import { RuntimeGitHubIssueCommentCommands } from './runtime-github-issue-comment-commands'
import { githubAttachmentCaller } from '../../../github/attachment-preparation-contexts'
import { githubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
import { _resetOriginGitHubApiRepositoryCache } from '../../../github/github-api-repository'
import { buildRegistry, type RpcContext } from '../../rpc/core'
import { GITHUB_ISSUE_METHODS } from '../../rpc/methods/github-issue-methods'
import { GITHUB_ATTACHMENT_METHODS } from '../../rpc/methods/github-attachment-methods'
import type { Repo } from '../../../../shared/repo-types'
import type { GitHubAttachmentTarget } from '../../../../shared/rpc-contract/github-attachment-params'

const mocks = vi.hoisted(() => ({ gh: vi.fn(), remote: vi.fn(), binding: vi.fn(), claim: vi.fn() }))
vi.mock('../../../github/gh-utils', async (original) => ({
  ...(await original<typeof GhUtils>()),
  ghExecFileAsync: mocks.gh,
  getOwnerRepoForRemote: mocks.remote,
  acquire: async () => {},
  release: () => {}
}))
vi.mock('../../../github/github-project-account', () => ({
  resolveGitHubProjectAccount: mocks.binding
}))
vi.mock('../../../git/remotes/remote-name-listing', () => ({
  shouldProbeGitRemote: async () => true
}))
vi.mock('../../rpc/methods/clipboard', () => ({ claimClipboardImageUpload: mocks.claim }))

const methods = buildRegistry([...GITHUB_ISSUE_METHODS, ...GITHUB_ATTACHMENT_METHODS])
let repo: Repo
let distro: string | undefined
let commands: RuntimeGitHubIssueCommentCommands
let context: RpcContext
let target: GitHubAttachmentTarget
let remoteOwner: string
const caller = () => githubAttachmentCaller(context)
const upload = (preparationId?: string) =>
  commands.uploadGitHubAttachment(
    { target, preparationId, fileName: 'screen.png', contentType: 'image/png' },
    mocks.claim,
    undefined,
    caller()
  )
async function invoke(name: string, params: unknown) {
  const method = methods.get(name)
  if (!method || 'stream' in method) {
    throw new Error('Missing nonstreaming method')
  }
  return method.handler(method.params?.parse(params), context)
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetOriginGitHubApiRepositoryCache()
  repo = {
    id: 'repo',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: 'blue',
    addedAt: 1,
    ghAccount: { host: 'github.com', user: 'account-a' }
  }
  distro = undefined
  remoteOwner = 'original'
  mocks.remote.mockReset().mockImplementation(async () => ({ owner: remoteOwner, repo: 'images' }))
  mocks.binding.mockReset().mockImplementation(() => ({ ghAccount: repo.ghAccount }))
  mocks.claim.mockReset().mockReturnValue(Buffer.from([0, 128, 255]))
  mocks.gh.mockReset().mockImplementation(async (args) => {
    if (args[0] === 'api' && args[1] === 'repos/original/images') {
      return { stdout: '{"id":123}' }
    }
    if (args.includes('Content-Type: application/octet-stream')) {
      return { stdout: '{"url":"https://github.com/user-attachments/assets/image"}' }
    }
    return { stdout: '{"number":42,"html_url":"https://github.com/original/images/issues/42"}' }
  })
  commands = new RuntimeGitHubIssueCommentCommands({
    resolveRepo: async () => repo,
    getLocalGitArgs: () => (distro ? [{ wslDistro: distro }] : []),
    resolveHostedReviewTarget: async () => ({ repo, repoPath: '/worktree' })
  })
  // SAFETY: these production method handlers use only the supplied command surface and caller fields.
  context = {
    caller: { kind: 'desktop' },
    connectionId: 'renderer-1',
    runtime: {
      uploadGitHubAttachment: commands.uploadGitHubAttachment.bind(commands),
      withGitHubAttachmentPreparation: commands.withGitHubAttachmentPreparation.bind(commands),
      createRepoIssue: commands.createRepoIssue.bind(commands),
      updateRepoIssue: commands.updateRepoIssue.bind(commands),
      addRepoIssueComment: commands.addRepoIssueComment.bind(commands)
    }
  } as unknown as RpcContext
  target = {
    kind: 'repo',
    repo: 'repo',
    source: 'issue',
    expectedRepoSelection: githubAttachmentRepoSelection(repo, {}),
    expectedGhAccount: repo.ghAccount
  }
})
afterEach(() => {
  commands.disposeGitHubAttachments()
  vi.useRealTimers()
})

describe('GitHub attachment preparation and publication', () => {
  it.each([2, 20])(
    'reuses one upload target and metadata lookup for %i images beyond the discovery TTL, then publishes once',
    async (count) => {
      let id: string | undefined
      for (let index = 0; index < count; index++) {
        const result = await invoke('github.uploadAttachment', {
          target,
          preparationId: id,
          uploadId: 'stage',
          fileName: 'screen.png',
          contentType: 'image/png'
        })
        if (
          !result ||
          typeof result !== 'object' ||
          !('preparationId' in result) ||
          typeof result.preparationId !== 'string'
        ) {
          throw new Error('Missing context')
        }
        id = result.preparationId
        await vi.advanceTimersByTimeAsync(60_000)
      }
      expect(mocks.remote).toHaveBeenCalledTimes(1)
      expect(
        mocks.gh.mock.calls.filter(([args]) => args[1] === 'repos/original/images')
      ).toHaveLength(1)
      expect(
        mocks.gh.mock.calls.filter(([args]) =>
          args.includes('Content-Type: application/octet-stream')
        )
      ).toHaveLength(count)
      await expect(
        invoke('github.createIssue', {
          repo: 'repo',
          title: 'With image',
          body: '![screen](https://github.com/user-attachments/assets/image)',
          attachmentPreparationId: id
        })
      ).resolves.toMatchObject({ ok: true, number: 42 })
      expect(mocks.remote).toHaveBeenCalledTimes(3)
      expect(mocks.gh.mock.calls.at(-1)?.[1]).toMatchObject({
        ghAccount: { host: 'github.com', user: 'account-a' }
      })
      await expect(
        invoke('github.createIssue', {
          repo: 'repo',
          title: 'Again',
          body: 'Body',
          attachmentPreparationId: id
        })
      ).rejects.toThrow('expired or changed')
    }
  )

  it.each(['bound-account', 'new-binding', 'source', 'route', 'wsl'])(
    'refuses %s changes before a later claim and before final effects',
    async (change) => {
      if (change === 'new-binding') {
        repo.ghAccount = undefined
        target = {
          ...target,
          expectedGhAccount: null,
          expectedRepoSelection: githubAttachmentRepoSelection(repo, {})
        }
      }
      const { preparationId } = await upload()
      if (change === 'bound-account' || change === 'new-binding') {
        repo = { ...repo, ghAccount: { host: 'github.com', user: 'account-b' } }
      }
      if (change === 'source') {
        repo = { ...repo, issueSourcePreference: 'origin' }
      }
      if (change === 'route') {
        repo = { ...repo, connectionId: 'other-host' }
      }
      if (change === 'wsl') {
        distro = 'Ubuntu'
      }
      mocks.claim.mockClear()
      mocks.gh.mockClear()
      await expect(upload(preparationId)).rejects.toThrow('draft is kept')
      expect(mocks.claim).not.toHaveBeenCalled()
      expect(mocks.gh).not.toHaveBeenCalled()
      await expect(
        invoke('github.createIssue', {
          repo: 'repo',
          title: 'Unsafe',
          body: 'Body',
          attachmentPreparationId: preparationId
        })
      ).rejects.toThrow('expired or changed')
    }
  )

  it.each(['create', 'update', 'comment'])(
    'detects a changed target during final %s resolution before any mutation',
    async (writer) => {
      const { preparationId } = await upload()
      remoteOwner = 'changed'
      mocks.gh.mockClear()
      const params =
        writer === 'create'
          ? { title: 'Title', body: 'Body' }
          : writer === 'update'
            ? { number: 42, updates: { title: 'Changed', body: 'Body' } }
            : { number: 42, body: 'Body' }
      await expect(
        invoke(
          `github.${writer === 'create' ? 'createIssue' : writer === 'update' ? 'updateIssue' : 'addIssueComment'}`,
          { repo: 'repo', ...params, attachmentPreparationId: preparationId }
        )
      ).rejects.toThrow('destination or account changed')
      expect(mocks.gh).not.toHaveBeenCalled()
    }
  )

  it('checks the first staging-window expectation and the final binding before effects', async () => {
    repo = { ...repo, issueSourcePreference: 'origin' }
    await expect(upload()).rejects.toThrow('destination or account changed')
    expect(mocks.claim).not.toHaveBeenCalled()
    target = { ...target, expectedRepoSelection: githubAttachmentRepoSelection(repo, {}) }
    const { preparationId } = await upload()
    repo = { ...repo, ghAccount: undefined }
    mocks.gh.mockClear()
    await expect(
      invoke('github.updateIssue', {
        repo: 'repo',
        number: 42,
        updates: { state: 'closed', body: 'Body' },
        attachmentPreparationId: preparationId
      })
    ).rejects.toThrow('destination or account changed')
    expect(mocks.gh).not.toHaveBeenCalled()
  })

  it('retires only a closed connection and retains successful contexts through normal per-image cleanup', async () => {
    const first = await upload()
    context = { ...context, connectionId: 'renderer-2' }
    const second = await upload()
    commands.retireGitHubAttachmentsForConnection('renderer-1')
    await expect(upload(first.preparationId)).rejects.toThrow('expired or changed')
    await expect(upload(second.preparationId)).resolves.toMatchObject({
      preparationId: second.preparationId
    })
  })
})
