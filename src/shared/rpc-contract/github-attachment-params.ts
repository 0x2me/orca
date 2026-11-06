import { z } from 'zod'
import { GitHubAttachmentRepoSelection } from '../github/attachment-repo-selection'
import { RepoWithGitHubAccountExpectation, SlugRepo } from './github-repo-target-params'

export const GitHubAttachmentTarget = z.discriminatedUnion('kind', [
  RepoWithGitHubAccountExpectation.extend({
    kind: z.literal('repo'),
    source: z.enum(['issue', 'origin']),
    expectedRepoSelection: GitHubAttachmentRepoSelection.optional()
  }),
  SlugRepo.extend({ kind: z.literal('slug'), wakeWslDistro: z.boolean().optional() })
])
export type GitHubAttachmentTarget = z.infer<typeof GitHubAttachmentTarget>
export const UploadGitHubAttachment = z.object({
  uploadId: z.string().min(1),
  preparationId: z.string().min(1).optional(),
  target: GitHubAttachmentTarget,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100)
})
