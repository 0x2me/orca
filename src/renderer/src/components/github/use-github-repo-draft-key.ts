import { useAppStore } from '@/store'
import { resolveGitHubRepoOperationOwner } from '@/lib/github-source-runtime-context'
import { githubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
import type { TaskSourceContext } from '../../../../shared/task-source-context'

export function useGitHubRepoDraftKey(args: {
  repoId?: string | null
  repoPath?: string | null
  sourceContext?: TaskSourceContext | null
}): string {
  return useAppStore((state) => {
    const owner = resolveGitHubRepoOperationOwner(state, args)
    return JSON.stringify([
      owner.target,
      owner.repo ? githubAttachmentRepoSelection(owner.repo, {}) : null
    ])
  })
}
