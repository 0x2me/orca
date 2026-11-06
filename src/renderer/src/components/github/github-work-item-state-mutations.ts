import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { GhAccountBinding } from '../../../../shared/github/account-binding'
import { GITHUB_ACCOUNT_EXPECTATION_RUNTIME_CAPABILITY } from '../../../../shared/task-source-runtime-capabilities'
import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status-connection-generation'
import { RUNTIME_CONNECTION_CHANGED_MESSAGE } from '@/web/web-runtime-request-registry'
import { getGitHubMutationTarget } from './github-work-item-mutation-target'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { gitHubSlugApiForTarget } from '@/runtime/github-slug-owner-api'
import {
  getGitHubSourceRuntimeHost,
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

export function setPRFileViewedForRepo(args: {
  repoId: string
  repoPath: string
  sourceContext?: TaskSourceContext | null
  prNumber: number
  prRepo?: GitHubOwnerRepo | null
  pullRequestId: string
  path: string
  viewed: boolean
  expectedGhAccount?: GhAccountBinding | null
  target?: RuntimeClientTarget
}): Promise<boolean> {
  const runtimeHost = getGitHubSourceRuntimeHost(args.sourceContext)
  const target = runtimeHost
    ? { kind: 'environment' as const, environmentId: runtimeHost.environmentId }
    : (args.target ?? { kind: 'local' as const })
  if (target.kind === 'environment') {
    const generation = getRuntimeEnvironmentConnectionGeneration(target.environmentId)
    const expectedGhAccount = args.expectedGhAccount
    const params = {
      repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
      prRepo: args.prRepo ?? null,
      pullRequestId: args.pullRequestId,
      path: args.path,
      viewed: args.viewed
    }
    return callRuntimeRpc<boolean>(target, 'github.setPRFileViewed', params, {
      timeoutMs: 30_000,
      ...(expectedGhAccount !== undefined
        ? {
            paramsForStatus: (status: RuntimeStatus | null) => ({
              ...params,
              ...(status?.capabilities?.includes(GITHUB_ACCOUNT_EXPECTATION_RUNTIME_CAPABILITY)
                ? { expectedGhAccount }
                : {})
            }),
            beforeSend: () => {
              if (getRuntimeEnvironmentConnectionGeneration(target.environmentId) !== generation) {
                throw new Error(RUNTIME_CONNECTION_CHANGED_MESSAGE)
              }
            }
          }
        : {})
    }).then((ok) => {
      if (ok) {
        notifyWorkItemDetailsMutation(
          {
            repoPath: args.repoPath,
            repoId: args.repoId,
            sourceContext: args.sourceContext,
            type: 'pr',
            number: args.prNumber
          },
          { local: false }
        )
      }
      return ok
    })
  }
  return window.api.gh.setPRFileViewed({
    repoPath: args.repoPath,
    repoId: args.repoId,
    sourceContext: args.sourceContext,
    prNumber: args.prNumber,
    prRepo: args.prRepo ?? null,
    pullRequestId: args.pullRequestId,
    path: args.path,
    viewed: args.viewed,
    ...(args.expectedGhAccount !== undefined ? { expectedGhAccount: args.expectedGhAccount } : {})
  })
}
