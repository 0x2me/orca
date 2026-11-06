import {
  gitHubImageContext,
  prepareGitHubImages,
  type GitHubImageUploadContext
} from '@/components/github/prepare-github-images'
import type { GitHubDraftPreparation } from '@/components/github/github-work-item-comment-mutations'
import type { Repo } from '../../../../shared/repo-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { CreateHostedReviewStoreInput } from './hosted-review-cache-state'

export async function prepareHostedReviewImages<T extends CreateHostedReviewStoreInput>(
  repo: Repo | null | undefined,
  runtime: RuntimeClientTarget,
  repoPath: string,
  input: T,
  preparation?: GitHubDraftPreparation
): Promise<{ input: T; context: GitHubImageUploadContext }> {
  let context: GitHubImageUploadContext = {
    runtime,
    target: {
      kind: 'repo',
      repo: repo?.id ?? repoPath,
      source: 'origin',
      expectedGhAccount: repo?.ghAccount ?? null
    }
  }
  if (input.provider === 'github' && preparation) {
    context = gitHubImageContext(context)
    const body = await prepareGitHubImages({ body: input.body ?? '', ...preparation, context })
    if (context.attachmentPreparationId) {
      preparation.signal.throwIfAborted()
    }
    input = { ...input, body }
  }
  return { input, context }
}
