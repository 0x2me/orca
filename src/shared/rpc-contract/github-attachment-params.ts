import { z } from 'zod'
import { RepoWithGitHubAccountExpectation, SlugRepo } from './github-repo-target-params'

export const GitHubAttachmentTarget = z.discriminatedUnion('kind', [
  RepoWithGitHubAccountExpectation.extend({
    kind: z.literal('repo'),
    source: z.enum(['issue', 'origin'])
  }),
  SlugRepo.extend({ kind: z.literal('slug') })
])
export type GitHubAttachmentTarget = z.infer<typeof GitHubAttachmentTarget>
export const UploadGitHubAttachment = z.object({
  uploadId: z.string().min(1),
  target: GitHubAttachmentTarget,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100)
})
