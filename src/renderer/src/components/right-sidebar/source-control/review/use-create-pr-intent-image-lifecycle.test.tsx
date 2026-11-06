// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserImageParserFixture } from '../../../../../../shared/github/__fixtures__/image-parser-worker-fixture'
import { getDefaultSettings } from '../../../../../../shared/constants'
import {
  DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
  getDefaultSourceControlAiSettings
} from '../../../../../../shared/source-control/ai/settings/source-control-ai-settings'
import type { HostedReviewCreationEligibility } from '../../../../../../shared/source-control/hosted-review/hosted-review-contracts'
import { localizedHostedReviewCopy } from '@/i18n/hosted-review-localized-copy'
import { prepareHostedReviewImages } from '@/store/slices/prepare-hosted-review-images'
import { makeRepo } from '../../../worktree-jump/worktree-jump-palette-test-fixtures'
import type { CreatePrIntentReviewInput } from './create-pr-intent-review-input'
import { useSourceControlCreatePrIntentReview } from './use-create-pr-intent-review'

const runtime = vi.hoisted(() => ({ generate: vi.fn(), rpc: vi.fn() }))
vi.mock('@/runtime/runtime-git-generation-client', () => ({
  generateRuntimePullRequestFields: runtime.generate
}))
vi.mock('@/runtime/github-attachment-rpc', () => ({ callGitHubAttachmentRpc: runtime.rpc }))

afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('pagehide'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  runtime.generate.mockReset()
  runtime.rpc.mockReset()
})

it.each(['target', 'body'] as const)(
  'prepares images after a committed %s change without reviving invalidated generation',
  async (changed) => {
    vi.stubGlobal('Worker', BrowserImageParserFixture)
    const image = '![screenshot](data:image/png;base64,AA==)'
    const hosted = '![screenshot](https://github.com/user-attachments/assets/prepared)'
    runtime.rpc.mockImplementation(async (_target, method) => {
      if (method === 'status.get') {
        return { capabilities: ['github.image-attachments.v1'] }
      }
      if (method === 'repo.show') {
        return {
          githubAttachmentSelection: {
            id: 'repo-1',
            path: '/repos/repo-1',
            issueSourcePreference: 'auto',
            connectionId: null,
            executionHostId: null,
            wslDistro: null,
            ghAccount: null
          }
        }
      }
      if (method === 'clipboard.startImageUpload') {
        return { uploadId: 'stage' }
      }
      if (method === 'github.uploadAttachment') {
        return {
          url: 'https://github.com/user-attachments/assets/prepared',
          preparationId: 'prepared'
        }
      }
      return {}
    })
    const token = {
      repoId: 'repo-1',
      worktreeId: 'worktree-a',
      worktreePath: '/repos/repo-1/a',
      branch: 'feature-a',
      provider: 'github' as const,
      baseRef: null,
      pinnedCopy: null,
      startedAt: 1
    }
    const eligibility: HostedReviewCreationEligibility = {
      provider: 'github',
      review: null,
      canCreate: true,
      blockedReason: null,
      nextAction: null,
      reviewLookupOutcome: 'not_found',
      defaultBaseRef: 'main',
      title: 'Screenshot change',
      body: image
    }
    const publish = vi.fn()
    const repo = makeRepo()
    const create: CreatePrIntentReviewInput['createHostedReview'] = async (
      repoPath,
      input,
      preparation
    ) => {
      const prepared = await prepareHostedReviewImages(
        repo,
        { kind: 'local' },
        repoPath,
        input,
        preparation
      )
      publish(prepared.input.worktreePath, prepared.input.body)
      return { ok: true, number: 42, url: 'https://github.com/owner/repo/pull/42' }
    }
    const input: CreatePrIntentReviewInput = {
      activeRepo: repo,
      createHostedReview: create,
      createPrInFlightRef: { current: {} },
      createPrIntentActiveTargetConflicts: () => false,
      createPrIntentCurrentTargetRef: { current: token },
      createPrIntentRunStillOwnsWorktree: () => true,
      getCreatePrIntentOperationTarget: () => ({
        target: { kind: 'local' },
        worktreeId: 'worktree-a',
        worktreePath: '/repos/repo-1/a'
      }),
      handlePullRequestCreated: vi.fn(),
      hostedReviewCreateCopy: localizedHostedReviewCopy('github'),
      prBase: 'main',
      prBody: image,
      setPrBody: vi.fn(),
      resolvedPrCreationDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
      setCreatePrInFlightByWorktree: vi.fn(),
      setCreatePrIntentNoticeForWorktree: vi.fn(),
      settings: null
    }
    const view = renderHook(useSourceControlCreatePrIntentReview, { initialProps: input })
    const next =
      changed === 'target'
        ? { ...token, worktreeId: 'worktree-b', worktreePath: '/repos/repo-1/b' }
        : token
    const currentInput = { ...input, prBody: changed === 'body' ? `replacement ${image}` : image }
    input.createPrIntentCurrentTargetRef.current = next
    view.rerender(currentInput)
    let created = false
    await act(async () => {
      created = await view.result.current.createHostedReviewForCreatePrIntent(next, eligibility)
    })
    expect(created).toBe(true)
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      changed === 'target' ? '/repos/repo-1/b' : '/repos/repo-1/a',
      hosted
    )

    const generation = Promise.withResolvers<{
      success: true
      fields: { base: string; title: string; body: string; draft: boolean }
    }>()
    runtime.generate.mockReturnValue(generation.promise)
    const settings = getDefaultSettings('/fixture')
    settings.sourceControlAi = { ...getDefaultSourceControlAiSettings(), agentId: 'cursor' }
    view.rerender({ ...currentInput, settings })
    let pending!: Promise<boolean>
    act(() => {
      pending = view.result.current.createHostedReviewForCreatePrIntent(next, eligibility)
    })
    expect(runtime.generate).toHaveBeenCalled()
    runtime.rpc.mockClear()
    vi.mocked(input.setPrBody!).mockClear()
    const replacement = { ...currentInput, prBody: 'Replacement draft remains here', settings }
    view.rerender(replacement)
    await act(async () => {
      generation.resolve({
        success: true,
        fields: { base: 'main', title: 'Generated change', body: image, draft: false }
      })
      expect(await pending).toBe(false)
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(runtime.rpc).not.toHaveBeenCalled()
    expect(input.setPrBody).not.toHaveBeenCalled()
    view.rerender({ ...replacement, settings: null })
    await act(async () => {
      expect(await view.result.current.createHostedReviewForCreatePrIntent(next, eligibility)).toBe(
        true
      )
    })
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith(
      changed === 'target' ? '/repos/repo-1/b' : '/repos/repo-1/a',
      hosted
    )
  }
)
