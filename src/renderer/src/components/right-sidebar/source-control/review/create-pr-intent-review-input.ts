import type { SourceControlAi } from '../ai/use-ai'
import type { SourceControlStoreActions } from '../listing/use-store-actions'
import type { SourceControlWorktreeContext } from '../listing/use-worktree-context'
import type { SourceControlWorktreeOperationState } from '../panel/use-worktree-operation-state'
import type { SourceControlCreatePrIntentTarget } from './use-create-pr-intent-target'
import type { SourceControlCreateReviewComposer } from './use-create-review-composer'
import type { SourceControlHostedReviewCreated } from './use-hosted-review-created'
import type { SourceControlHostedReviewState } from './use-hosted-review-state'

export type CreatePrIntentReviewInput = {
  activeRepo: SourceControlWorktreeContext['activeRepo']
  createHostedReview: SourceControlStoreActions['createHostedReview']
  createPrInFlightRef: SourceControlWorktreeOperationState['createPrInFlightRef']
  createPrIntentActiveTargetConflicts: SourceControlWorktreeOperationState['createPrIntentActiveTargetConflicts']
  createPrIntentCurrentTargetRef: SourceControlWorktreeOperationState['createPrIntentCurrentTargetRef']
  createPrIntentRunStillOwnsWorktree: SourceControlWorktreeOperationState['createPrIntentRunStillOwnsWorktree']
  getCreatePrIntentOperationTarget: SourceControlCreatePrIntentTarget['getCreatePrIntentOperationTarget']
  handlePullRequestCreated: SourceControlHostedReviewCreated['handlePullRequestCreated']
  hostedReviewCreateCopy: SourceControlHostedReviewState['hostedReviewCreateCopy']
  prBase: SourceControlCreateReviewComposer['prBase']
  prBody: SourceControlCreateReviewComposer['prBody']
  setPrBody?: SourceControlCreateReviewComposer['setPrBody']
  resolvedPrCreationDefaults: SourceControlAi['resolvedPrCreationDefaults']
  setCreatePrInFlightByWorktree: SourceControlWorktreeOperationState['setCreatePrInFlightByWorktree']
  setCreatePrIntentNoticeForWorktree: SourceControlWorktreeOperationState['setCreatePrIntentNoticeForWorktree']
  settings: SourceControlWorktreeContext['settings']
}
