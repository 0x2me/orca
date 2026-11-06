import { useRef } from 'react'
import { useAppStore } from '@/store'
import { resolveGitHubRepoOperationOwner } from '@/lib/github-source-runtime-context'
import { githubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
import type { TaskSourceContext } from '../../../../shared/task-source-context'

export function useGitHubRepoDraftKey(args: {
  repoId?: string | null
  repoPath?: string | null
  sourceContext?: TaskSourceContext | null
}): string {
  const previous = useRef<{
    repos: ReturnType<typeof useAppStore.getState>['repos']
    environment: string | null
    repoId: typeof args.repoId
    repoPath: typeof args.repoPath
    provider: TaskSourceContext['provider'] | undefined
    sourceRepoId: string | null | undefined
    hostId: TaskSourceContext['hostId'] | undefined
    key: string
  } | null>(null)
  return useAppStore((state) => {
    const environment = state.settings?.activeRuntimeEnvironmentId ?? null
    const { repoId, repoPath, sourceContext } = args
    const provider = sourceContext?.provider
    const sourceRepoId = sourceContext?.repoId
    const hostId = sourceContext?.hostId
    const cached = previous.current
    if (
      cached &&
      cached.repos === state.repos &&
      cached.environment === environment &&
      cached.repoId === repoId &&
      cached.repoPath === repoPath &&
      cached.provider === provider &&
      cached.sourceRepoId === sourceRepoId &&
      cached.hostId === hostId
    ) {
      return cached.key
    }
    const owner = resolveGitHubRepoOperationOwner(state, args)
    const key = JSON.stringify([
      owner.target,
      owner.repo ? githubAttachmentRepoSelection(owner.repo, {}) : null
    ])
    previous.current = {
      repos: state.repos,
      environment,
      repoId,
      repoPath,
      provider,
      sourceRepoId,
      hostId,
      key
    }
    return key
  })
}
