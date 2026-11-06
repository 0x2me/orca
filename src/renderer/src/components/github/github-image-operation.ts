import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import { taskSourceRuntimeTarget } from '@/lib/task-source-runtime-target'
import {
  isTwinRepo,
  runtimeTargetForRepoOwner,
  type RepoRuntimeOwnerState
} from '@/lib/repo-runtime-owner'
import { projectViewCacheKeyTarget } from '@/store/github/cache-identity'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type { GitHubImageUploadContext } from './prepare-github-images'
import {
  resolvePullRequestRepo,
  type GitHubWorkItemProjectOrigin
} from './github-work-item-identity'

export type GitHubRepoImageOperation = {
  repoPath?: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  prRepo?: GitHubOwnerRepo | null
}
export type GitHubBodyImageOperation = {
  item: Pick<GitHubWorkItem, 'type' | 'repoId' | 'url' | 'prRepo'>
  repoPath: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
  parsedSlug: GitHubOwnerRepo | null
}
export type GitHubImageOperation =
  | (GitHubRepoImageOperation & { action: 'comment'; source: 'issue' | 'origin' })
  | (GitHubBodyImageOperation & { action: 'body' })

export function gitHubRepoImageContext(
  args: GitHubRepoImageOperation,
  source: 'issue' | 'origin'
): GitHubImageUploadContext {
  const host = getGitHubSourceRuntimeHost(args.sourceContext)
  return {
    repoObservation: {
      repoId: getGitHubRuntimeRepoId(args.sourceContext, args.repoId),
      repoPath: args.repoPath ?? undefined,
      hostId: args.sourceContext?.provider === 'github' ? args.sourceContext.hostId : undefined
    },
    runtime: host ? { kind: 'environment', environmentId: host.environmentId } : { kind: 'local' },
    target: {
      kind: 'repo',
      repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath ?? '',
      source,
      ...(args.prRepo ? { ownerRepo: args.prRepo } : {})
    }
  }
}

export function gitHubBodyImageContext(
  state: RepoRuntimeOwnerState,
  args: GitHubBodyImageOperation
): GitHubImageUploadContext {
  const slug =
    args.item.type === 'pr'
      ? (resolvePullRequestRepo(args.item, args.projectOrigin) ?? args.parsedSlug)
      : args.projectOrigin
  if (args.item.type === 'pr' && !slug) {
    throw new Error('No GitHub repository context available for this pull request.')
  }
  if (slug) {
    return {
      runtime:
        args.sourceContext?.provider === 'github'
          ? taskSourceRuntimeTarget(args.sourceContext)
          : resolveGitHubMutationTarget(state, args.item.repoId, args.projectOrigin),
      target: { kind: 'slug', ...slug }
    }
  }
  if (!args.parsedSlug) {
    throw new Error('Unable to identify this GitHub item. Open it again from Tasks.')
  }
  if (!args.repoPath && !getGitHubSourceRuntimeHost(args.sourceContext)) {
    throw new Error('No repo context available for this edit.')
  }
  return gitHubRepoImageContext(
    {
      ...args,
      repoId: args.item.repoId,
      prRepo: args.parsedSlug
    },
    'issue'
  )
}

export function resolveGitHubImageOperation(
  state: RepoRuntimeOwnerState,
  args: GitHubImageOperation
): GitHubImageUploadContext {
  return args.action === 'comment'
    ? gitHubRepoImageContext(args, args.source)
    : gitHubBodyImageContext(state, args)
}

/** Keep action-time errors in the existing submit error surface, after accepted reads drain. */
export function captureGitHubImageOperation(
  state: RepoRuntimeOwnerState,
  args: GitHubImageOperation
): () => GitHubImageUploadContext {
  try {
    const context = resolveGitHubImageOperation(state, args)
    return () => context
  } catch (error) {
    return () => {
      throw error
    }
  }
}

export function resolveGitHubMutationTarget(
  state: RepoRuntimeOwnerState,
  repoId: string | null | undefined,
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
): RuntimeClientTarget {
  // Why: even slug-addressed project-origin mutations must run on the backing repo's owner host when its id is known.
  const owner = runtimeTargetForRepoOwner(state, repoId)
  if (owner) {
    return owner
  }
  // Why: a twin is tracked on two hosts; only the row's own source may stand in for its owner.
  if (isTwinRepo(state, repoId) && !projectOrigin) {
    throw new Error(`No single host owns project ${repoId}.`)
  }
  // Untracked Project rows use their source host; other slug edits use local credentials, never the focused server.
  return projectOrigin ? projectViewCacheKeyTarget(projectOrigin.cacheKey) : { kind: 'local' }
}
