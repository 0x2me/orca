import type { SourceControlAi } from '../ai/use-ai'
import type { SourceControlStoreActions } from '../listing/use-store-actions'
import type { SourceControlWorktreeContext } from '../listing/use-worktree-context'
import type { SourceControlWorktreeOperationState } from '../panel/use-worktree-operation-state'
import type { SourceControlCreateReviewComposer } from './use-create-review-composer'
import type { SourceControlHostedReviewCreated } from './use-hosted-review-created'
import type { SourceControlHostedReviewState } from './use-hosted-review-state'
import type { SourceControlPullRequestGeneration } from './use-pull-request-generation'

export type HostedReviewCreationInput = {
  activePullRequestGenerationKey: SourceControlPullRequestGeneration['activePullRequestGenerationKey']
  activeRepo: SourceControlWorktreeContext['activeRepo']
  activeWorktreeId: string | null
  branchName: string
  createHostedReview: SourceControlStoreActions['createHostedReview']
  createPrInFlightRef: SourceControlWorktreeOperationState['createPrInFlightRef']
  createStackedHostedReview: SourceControlStoreActions['createStackedHostedReview']
  handleGeneratePullRequestFields: SourceControlCreateReviewComposer['handleGeneratePullRequestFields']
  handlePullRequestCreated: SourceControlHostedReviewCreated['handlePullRequestCreated']
  hostedReviewCreateCopy: SourceControlHostedReviewState['hostedReviewCreateCopy']
  hostedReviewCreateProvider: SourceControlHostedReviewState['hostedReviewCreateProvider']
  hostedReviewCreation: SourceControlHostedReviewState['hostedReviewCreation']
  prAiGenerationEnabled: SourceControlCreateReviewComposer['prAiGenerationEnabled']
  prBase: SourceControlCreateReviewComposer['prBase']
  prBody: SourceControlCreateReviewComposer['prBody']
  setPrBody?: SourceControlCreateReviewComposer['setPrBody']
  prDraft: SourceControlCreateReviewComposer['prDraft']
  prFieldRevisions: SourceControlCreateReviewComposer['prFieldRevisions']
  prFieldsAreSeedPlaceholders: SourceControlCreateReviewComposer['prFieldsAreSeedPlaceholders']
  prGenerating: boolean
  prTitle: SourceControlCreateReviewComposer['prTitle']
  pullRequestFieldsInitialized: SourceControlCreateReviewComposer['pullRequestFieldsInitialized']
  resolvedPrCreationDefaults: SourceControlAi['resolvedPrCreationDefaults']
  setCreatePrInFlightByWorktree: SourceControlWorktreeOperationState['setCreatePrInFlightByWorktree']
  setCreatePrIntentNoticeForWorktree: SourceControlWorktreeOperationState['setCreatePrIntentNoticeForWorktree']
  settings: SourceControlWorktreeContext['settings']
  worktreePath: string | null
}
