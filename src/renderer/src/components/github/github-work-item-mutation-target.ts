import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { GitHubWorkItemProjectOrigin } from './github-work-item-identity'
import { resolveGitHubMutationTarget } from './github-image-operation'
export { resolveGitHubMutationTarget } from './github-image-operation'

export function getGitHubMutationTarget(
  repoId: string | null | undefined,
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
): RuntimeClientTarget {
  return resolveGitHubMutationTarget(useAppStore.getState(), repoId, projectOrigin)
}
