import { getGitHubMutationTarget } from './github-work-item-mutation-target'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { gitHubSlugApiForTarget } from '@/runtime/github-slug-owner-api'
import {
  getGitHubRepoRoutingTarget,
  getGitHubRuntimeRepoId
} from '@/lib/github-source-runtime-context'
import { taskSourceRuntimeTarget } from '@/lib/task-source-runtime-target'
import type { GitHubWorkItemProjectOrigin } from './github-work-item-identity'
import { notifyWorkItemDetailsMutation } from './github-work-item-comment-mutations'
import { githubProjectHost } from '../../../../shared/github/project-identity'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import { codeHostErrorText } from '@/lib/code-host-error-copy'

export async function runPullRequestStateUpdate(args: {
  repoPath: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
  number: number
  prRepo?: GitHubOwnerRepo | null
  updates: { state: 'open' | 'closed' }
}): Promise<void> {
  if (args.projectOrigin) {
    const target =
      args.sourceContext?.provider === 'github'
        ? taskSourceRuntimeTarget(args.sourceContext)
        : getGitHubMutationTarget(args.repoId, args.projectOrigin)
    const updateArgs = {
      owner: args.projectOrigin.owner,
      repo: args.projectOrigin.repo,
      host: githubProjectHost(args.projectOrigin.host),
      number: args.number,
      updates: args.updates
    }
    const res = await gitHubSlugApiForTarget(target).updatePullRequestBySlug({
      ...updateArgs,
      wakeWslDistro: true
    })
    if (!res.ok) {
      throw new Error(res.error.message)
    }
    if (target.kind === 'environment') {
      notifyWorkItemDetailsMutation(
        {
          repoPath: args.repoPath ?? '',
          repoId: args.repoId ?? undefined,
          sourceContext: args.sourceContext,
          type: 'pr',
          number: args.number
        },
        { local: false }
      )
    }
    return
  }
  // Why: close/reopen must route by the repo owner host like merge (#6957).
  const target = getGitHubRepoRoutingTarget(useAppStore.getState(), args.repoId, args.sourceContext)
  if (!args.repoPath && target.kind !== 'environment') {
    throw new Error('No repo context available for this pull request.')
  }
  const res =
    target.kind === 'environment'
      ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.updatePRState>>>(
          target,
          'github.updatePRState',
          {
            repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId ?? ''),
            prNumber: args.number,
            prRepo: args.prRepo ?? null,
            updates: args.updates
          },
          { timeoutMs: 30_000 }
        )
      : await window.api.gh.updatePRState({
          repoPath: args.repoPath ?? '',
          repoId: args.repoId ?? undefined,
          sourceContext: args.sourceContext,
          prNumber: args.number,
          prRepo: args.prRepo ?? null,
          updates: args.updates
        })
  if (!res.ok) {
    throw new Error(codeHostErrorText(res))
  }
  if (target.kind === 'environment') {
    notifyWorkItemDetailsMutation(
      {
        repoPath: args.repoPath ?? '',
        repoId: args.repoId ?? undefined,
        sourceContext: args.sourceContext,
        type: 'pr',
        number: args.number
      },
      { local: false }
    )
  }
}
