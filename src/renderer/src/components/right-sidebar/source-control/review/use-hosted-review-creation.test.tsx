// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { localizedHostedReviewCopy } from '@/i18n/hosted-review-localized-copy'
import { makeRepo } from '../../../worktree-jump/worktree-jump-palette-test-fixtures'
import { DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS } from '../../../../../../shared/source-control/ai/settings/source-control-ai-settings'
import type { HostedReviewCreationInput } from './hosted-review-creation-input'
import { useSourceControlHostedReviewCreation } from './use-hosted-review-creation'

type CreateResult = Awaited<ReturnType<HostedReviewCreationInput['createHostedReview']>>

afterEach(cleanup)

it('creates for the next worktree while an accepted text create still runs for the previous worktree', async () => {
  let completeFirst!: (result: CreateResult) => void
  const firstResult = new Promise<CreateResult>((resolve) => {
    completeFirst = resolve
  })
  const secondResult = Promise.withResolvers<CreateResult>()
  const created = vi.fn().mockResolvedValue(undefined)
  const create = vi
    .fn<HostedReviewCreationInput['createHostedReview']>()
    .mockReturnValueOnce(firstResult)
    .mockReturnValueOnce(secondResult.promise)
  const input: HostedReviewCreationInput = {
    activePullRequestGenerationKey: null,
    activeRepo: makeRepo(),
    activeWorktreeId: 'worktree-a',
    branchName: 'feature-a',
    createHostedReview: create,
    createPrInFlightRef: { current: {} },
    createStackedHostedReview: vi.fn(),
    handleGeneratePullRequestFields: vi.fn(),
    handlePullRequestCreated: created,
    hostedReviewCreateCopy: localizedHostedReviewCopy('github'),
    hostedReviewCreateProvider: 'github',
    hostedReviewCreation: {
      provider: 'github',
      review: null,
      canCreate: true,
      blockedReason: null,
      nextAction: null,
      reviewLookupOutcome: 'not_found'
    },
    prAiGenerationEnabled: false,
    prBase: 'main',
    prBody: 'Text-only description',
    prDraft: false,
    prFieldRevisions: { base: 0, title: 0, body: 0, draft: 0 },
    prFieldsAreSeedPlaceholders: false,
    prGenerating: false,
    prTitle: 'First change',
    pullRequestFieldsInitialized: true,
    resolvedPrCreationDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS,
    setCreatePrInFlightByWorktree: vi.fn(),
    setCreatePrIntentNoticeForWorktree: vi.fn(),
    settings: null,
    worktreePath: '/repo/worktree-a'
  }
  const view = renderHook((props) => useSourceControlHostedReviewCreation(props), {
    initialProps: input
  })
  let first!: Promise<void>
  act(() => {
    first = view.result.current.handleCreatePullRequest()
  })
  view.rerender({
    ...input,
    activeWorktreeId: 'worktree-b',
    branchName: 'feature-b',
    prTitle: 'Second change',
    worktreePath: '/repo/worktree-b'
  })
  let second!: Promise<void>
  act(() => {
    second = view.result.current.handleCreatePullRequest()
  })
  expect(create).toHaveBeenCalledWith(
    '/repos/repo-1',
    expect.objectContaining({ head: 'feature-b' }),
    expect.any(Object)
  )
  await act(async () => {
    completeFirst({
      ok: true,
      number: 42,
      url: 'https://github.com/owner/repo/pull/42'
    })
    await first
  })
  await act(async () => {
    await view.result.current.handleCreatePullRequest()
  })
  expect(create).toHaveBeenCalledTimes(2)
  await act(async () => {
    secondResult.resolve({ ok: true, number: 43, url: 'https://github.com/owner/repo/pull/43' })
    await second
  })
  expect(created).toHaveBeenCalledWith(
    { provider: 'github', number: 43, url: 'https://github.com/owner/repo/pull/43' },
    expect.objectContaining({ worktreeId: 'worktree-b', branch: 'feature-b' })
  )
  expect(created).toHaveBeenCalledWith(
    { provider: 'github', number: 42, url: 'https://github.com/owner/repo/pull/42' },
    expect.objectContaining({ worktreeId: 'worktree-a', branch: 'feature-a' })
  )
})
