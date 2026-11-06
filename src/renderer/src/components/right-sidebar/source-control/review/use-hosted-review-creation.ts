import { githubAttachmentRepoSelection } from '../../../../../../shared/github/attachment-repo-selection'
import type { HostedReviewCreationInput } from './hosted-review-creation-input'
import { useGitHubDraft } from '@/components/github/use-github-draft'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  normalizeHostedReviewHeadRef,
  normalizeHostedReviewBaseRef as stripBaseRef
} from '../../../../../../shared/source-control/hosted-review/hosted-review-refs'
import { resolveBlockedCreateReviewNoticeMessage } from './source-control-create-review-blocked-action'
import { localizedCreateFailure } from '../../hosted-review/provider-actions/hosted-review-create-failure-copy'
import type { HostedReviewCreatedContext } from './hosted-review-creation-state'
import type { PullRequestGenerationFields } from '@/store/slices/pull-request-generation'
import { useGenerateBeforeCreatePullRequest } from '../../hosted-review/creation/use-generate-before-create-pull-request'
import { createdReviewIsForeground } from '../../hosted-review/creation/created-review-foreground'
import { openAppHttpLink } from '@/lib/app-http-link-open'

/** Already-open and partial-stack failures can leave a real review that still needs linking. */
export function useSourceControlHostedReviewCreation({
  activePullRequestGenerationKey,
  activeRepo,
  activeWorktreeId,
  branchName,
  createHostedReview,
  createPrInFlightRef,
  createStackedHostedReview,
  handleGeneratePullRequestFields,
  handlePullRequestCreated,
  hostedReviewCreateCopy,
  hostedReviewCreateProvider,
  hostedReviewCreation,
  prAiGenerationEnabled,
  prBase,
  prBody,
  setPrBody,
  prDraft,
  prFieldRevisions,
  prFieldsAreSeedPlaceholders,
  prGenerating,
  prTitle,
  pullRequestFieldsInitialized,
  resolvedPrCreationDefaults,
  setCreatePrInFlightByWorktree,
  setCreatePrIntentNoticeForWorktree,
  settings,
  worktreePath
}: HostedReviewCreationInput) {
  const attachmentDraft = useGitHubDraft(
    prBody,
    (body) => setPrBody?.(body),
    JSON.stringify([
      activeRepo?.id,
      activeWorktreeId,
      branchName,
      activeRepo ? githubAttachmentRepoSelection(activeRepo, {}) : null
    ])
  )
  const createPullRequest = useCallback(
    async (stacked = false, generated?: PullRequestGenerationFields): Promise<void> =>
      attachmentDraft.submit(
        async (_body, signal) => {
          if (
            !activeRepo ||
            !activeWorktreeId ||
            !worktreePath ||
            !hostedReviewCreation ||
            prGenerating
          ) {
            return
          }

          if (!hostedReviewCreation.canCreate) {
            // Blocked clicks show inline prerequisite guidance.
            const message = resolveBlockedCreateReviewNoticeMessage(hostedReviewCreation)
            if (message) {
              setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
                tone: 'destructive',
                message
              })
            }
            return
          }

          const fields = generated ?? { base: prBase, title: prTitle, body: prBody, draft: prDraft }
          const base = stripBaseRef(fields.base).trim()
          const title = fields.title.trim()

          if (!title) {
            setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
              tone: 'destructive',
              message: translate(
                'auto.components.right.sidebar.SourceControl.f3a8b2c1d0e5',
                'Enter a {{value0}} title.',
                { value0: hostedReviewCreateCopy.reviewLabel }
              )
            })
            return
          }

          if (
            !base ||
            stripBaseRef(base).toLowerCase() === stripBaseRef(branchName).toLowerCase()
          ) {
            setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
              tone: 'destructive',
              message: translate(
                'auto.components.right.sidebar.SourceControl.ae743199cd',
                'Choose a different base branch before creating a {{value0}}.',
                { value0: hostedReviewCreateCopy.reviewLabel }
              )
            })
            return
          }

          setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
          const createdContext = (): HostedReviewCreatedContext => ({
            repoPath: activeRepo.path,
            repoId: activeRepo.id,
            branch: branchName,
            worktreeId: activeWorktreeId,
            openChecks: createdReviewIsForeground(activeWorktreeId)
          })
          try {
            const createInput = {
              repoId: activeRepo.id,
              provider: hostedReviewCreateProvider,
              base,
              head: normalizeHostedReviewHeadRef(branchName),
              title,
              body: fields.body,
              draft: fields.draft,
              worktreePath,
              useTemplate: resolvedPrCreationDefaults.useTemplate
            }
            const result = stacked
              ? await createStackedHostedReview(activeRepo.path, createInput, {
                  signal,
                  update: attachmentDraft.prepared
                })
              : await createHostedReview(activeRepo.path, createInput, {
                  signal,
                  update: attachmentDraft.prepared
                })

            if (result.ok) {
              setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
              const context = createdContext()
              await handlePullRequestCreated(
                {
                  provider: hostedReviewCreateProvider,
                  number: result.number,
                  url: result.url
                },
                context
              )
              if (context.openChecks && resolvedPrCreationDefaults.openAfterCreate) {
                openAppHttpLink(result.url, { worktreeId: activeWorktreeId })
              }
              return
            }

            if ('existingReview' in result && result.existingReview?.url) {
              const number = result.existingReview.number
              toast.success(
                number
                  ? translate(
                      'auto.components.right.sidebar.SourceControl.eef5446523',
                      '{{value0}} #{{value1}} is already open',
                      { value0: hostedReviewCreateCopy.titleLabel, value1: number }
                    )
                  : translate(
                      'auto.components.right.sidebar.SourceControl.d6fb1df5fe',
                      '{{value0}} is already open',
                      { value0: hostedReviewCreateCopy.titleLabel }
                    ),
                {
                  action: {
                    label: translate(
                      'auto.components.right.sidebar.SourceControl.812cb992ee',
                      'Open on {{value0}}',
                      { value0: hostedReviewCreateCopy.providerName }
                    ),
                    onClick: () =>
                      openAppHttpLink(result.existingReview!.url, { worktreeId: activeWorktreeId })
                  }
                }
              )
              if (number) {
                setCreatePrIntentNoticeForWorktree(activeWorktreeId, null)
                await handlePullRequestCreated(
                  {
                    provider: hostedReviewCreateProvider,
                    number,
                    url: result.existingReview.url
                  },
                  createdContext()
                )
                return
              }
            }

            // Link the created review before reporting stack-registration failure so the workspace knows it exists.
            if ('createdReview' in result && result.createdReview?.url) {
              const { number, url } = result.createdReview
              if (number) {
                await handlePullRequestCreated(
                  {
                    provider: hostedReviewCreateProvider,
                    number,
                    url
                  },
                  createdContext()
                )
              }
            }

            setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
              tone: 'destructive',
              message: localizedCreateFailure(result, hostedReviewCreateProvider)
            })
          } catch (error) {
            setCreatePrIntentNoticeForWorktree(activeWorktreeId, {
              tone: 'destructive',
              message:
                error instanceof Error
                  ? error.message
                  : translate(
                      'auto.components.right.sidebar.SourceControl.e2b7a1c0d9f4',
                      'Failed to create {{value0}}',
                      { value0: hostedReviewCreateCopy.reviewLabel }
                    )
            })
          }
        },
        () => {}
      ),
    [
      attachmentDraft,
      activeRepo,
      activeWorktreeId,
      branchName,
      createHostedReview,
      createStackedHostedReview,
      handlePullRequestCreated,
      hostedReviewCreation,
      hostedReviewCreateCopy.providerName,
      hostedReviewCreateCopy.reviewLabel,
      hostedReviewCreateCopy.titleLabel,
      hostedReviewCreateProvider,
      prBase,
      prBody,
      prDraft,
      prGenerating,
      prTitle,
      resolvedPrCreationDefaults.openAfterCreate,
      resolvedPrCreationDefaults.useTemplate,
      setCreatePrIntentNoticeForWorktree,
      worktreePath
    ]
  )

  const { handleCreatePullRequest: generateThenCreatePullRequest } =
    useGenerateBeforeCreatePullRequest({
      aiGenerationEnabled: prAiGenerationEnabled,
      canCreate: hostedReviewCreation?.canCreate === true,
      createPullRequest,
      fields: { base: prBase, title: prTitle, body: prBody, draft: prDraft },
      fieldRevisions: prFieldRevisions,
      fieldsInitialized: pullRequestFieldsInitialized,
      fieldsAreSeedPlaceholders: prFieldsAreSeedPlaceholders,
      generatePullRequestFields: handleGeneratePullRequestFields,
      generationKey: activePullRequestGenerationKey,
      repo: activeRepo,
      settings
    })

  const handleCreatePullRequest = useCallback(
    async (stacked = false): Promise<void> => {
      const worktreeId = activeWorktreeId
      if (!worktreeId || createPrInFlightRef.current[worktreeId]) {
        return
      }
      // Hold the click through creation so eligibility refreshes cannot close the composer during generation.
      createPrInFlightRef.current[worktreeId] = true
      setCreatePrInFlightByWorktree((prev) => ({ ...prev, [worktreeId]: true }))
      try {
        await generateThenCreatePullRequest(stacked)
      } finally {
        createPrInFlightRef.current[worktreeId] = false
        setCreatePrInFlightByWorktree((prev) => ({ ...prev, [worktreeId]: false }))
      }
    },
    [
      activeWorktreeId,
      createPrInFlightRef,
      generateThenCreatePullRequest,
      setCreatePrInFlightByWorktree
    ]
  )

  return { handleCreatePullRequest }
}

export type SourceControlHostedReviewCreation = ReturnType<
  typeof useSourceControlHostedReviewCreation
>
