import { z } from 'zod'
import { getRepoExecutionHostId, getRepoRoutingConnectionId } from '../execution-host'
import type { Repo } from '../repo-types'
import { OptionalGhAccountExpectation } from '../rpc-contract/github-repo-target-params'
import { normalizeGhAccountBinding } from './account-binding'

export const GitHubAttachmentRepoSelection = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  issueSourcePreference: z.enum(['auto', 'origin', 'upstream']),
  connectionId: z.string().nullable(),
  executionHostId: z.string().nullable(),
  wslDistro: z.string().nullable(),
  ghAccount: OptionalGhAccountExpectation.refine((value) => value !== undefined)
})
export type GitHubAttachmentRepoSelection = z.infer<typeof GitHubAttachmentRepoSelection>

export function githubAttachmentRepoSelection(
  repo: Repo,
  options: { wslDistro?: string }
): GitHubAttachmentRepoSelection {
  return {
    id: repo.id,
    path: repo.path,
    issueSourcePreference: repo.issueSourcePreference ?? 'auto',
    connectionId: getRepoRoutingConnectionId(repo),
    executionHostId: getRepoExecutionHostId(repo),
    wslDistro: options.wslDistro ?? null,
    ghAccount: normalizeGhAccountBinding(repo.ghAccount) ?? null
  }
}
