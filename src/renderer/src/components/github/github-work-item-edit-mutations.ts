import { prepareGitHubImages, captureGitHubImageContext } from './prepare-github-images'
import type { GitHubDraftPreparation } from './github-work-item-comment-mutations'
import { getGitHubMutationTarget } from './github-work-item-mutation-target'
export { getGitHubMutationTarget } from './github-work-item-mutation-target'
import { callGitHubTargetOperation } from '@/lib/github-work-item-target-request'
import { gitHubSlugApiForTarget } from '@/runtime/github-slug-owner-api'
import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import { taskSourceRuntimeTarget } from '@/lib/task-source-runtime-target'
import {
  resolvePullRequestRepo,
  type GitHubWorkItemProjectOrigin
} from '@/components/github/github-work-item-identity'
import { notifyWorkItemDetailsMutation } from '@/components/github/github-work-item-comment-mutations'
import { githubProjectHost } from '../../../../shared/github/project-identity'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import { codeHostErrorText } from '@/lib/code-host-error-copy'

export async function runIssueUpdate(args: {
  preparation?: GitHubDraftPreparation
  repoPath: string | null
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
  issueRepo?: GitHubOwnerRepo | null
  type?: 'issue' | 'pr'
  number: number
  updates: Parameters<typeof window.api.gh.updateIssue>[0]['updates']
}): Promise<void> {
  const issueRepo = args.projectOrigin
  if (issueRepo) {
    const target =
      args.sourceContext?.provider === 'github'
        ? taskSourceRuntimeTarget(args.sourceContext)
        : getGitHubMutationTarget(args.repoId, args.projectOrigin)
    const imageContext = await captureGitHubImageContext({
      runtime: target,
      target: { kind: 'slug', ...issueRepo }
    })
    const updates =
      args.preparation && args.updates.body !== undefined
        ? {
            ...args.updates,
            body: await prepareGitHubImages({
              body: args.updates.body,
              ...args.preparation,
              context: imageContext
            })
          }
        : args.updates
    args.preparation?.signal.throwIfAborted()
    const updateArgs = {
      owner: issueRepo.owner,
      repo: issueRepo.repo,
      host: githubProjectHost(issueRepo.host),
      number: args.number,
      updates
    }
    const res = await gitHubSlugApiForTarget(
      imageContext.runtime,
      imageContext.rpcOptions
    ).updateIssueBySlug({
      ...updateArgs,
      wakeWslDistro: true
    })
    if (!res.ok) {
      throw new Error(res.error.message)
    }
    notifyWorkItemDetailsMutation(
      {
        repoPath: args.repoPath ?? '',
        repoId: args.repoId ?? undefined,
        sourceContext: args.sourceContext,
        type: args.type ?? 'issue',
        number: args.number
      },
      { local: target.kind !== 'environment' }
    )
    return
  }
  if (!args.issueRepo) {
    throw new Error('Unable to identify this GitHub item. Open it again from Tasks.')
  }
  const runtimeHost = getGitHubSourceRuntimeHost(args.sourceContext)
  if (!args.repoPath && !runtimeHost) {
    throw new Error('No repo context available for this edit.')
  }
  const target = runtimeHost
    ? { kind: 'environment' as const, environmentId: runtimeHost.environmentId }
    : { kind: 'local' as const }
  const imageContext = await captureGitHubImageContext({
    runtime: target,
    target: {
      kind: 'repo',
      repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId ?? args.repoPath ?? ''),
      source: 'issue',
      ownerRepo: args.issueRepo
    }
  })
  const updates =
    args.preparation && args.updates.body !== undefined
      ? {
          ...args.updates,
          body: await prepareGitHubImages({
            body: args.updates.body,
            ...args.preparation,
            context: imageContext
          })
        }
      : args.updates
  args.preparation?.signal.throwIfAborted()
  const res = await callGitHubTargetOperation({
    target: imageContext.runtime,
    rpcOptions: imageContext.rpcOptions,
    ownerRepo: args.issueRepo,
    method: 'github.updateIssue',
    params: {
      repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId ?? ''),
      number: args.number,
      updates
    },
    local: (exact) =>
      window.api.gh.updateIssue({
        repoPath: args.repoPath ?? '',
        repoId: args.repoId ?? undefined,
        sourceContext: args.sourceContext,
        number: args.number,
        updates,
        ...exact
      })
  })
  if (!res.ok) {
    throw new Error(codeHostErrorText(res))
  }
  if (runtimeHost || args.type === 'pr') {
    notifyWorkItemDetailsMutation(
      {
        repoPath: args.repoPath ?? '',
        repoId: args.repoId ?? undefined,
        sourceContext: args.sourceContext,
        type: args.type ?? 'issue',
        number: args.number
      },
      { local: !runtimeHost }
    )
  }
}

export async function runWorkItemBodyUpdate(args: {
  preparation?: GitHubDraftPreparation
  item: GitHubWorkItem
  repoPath: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubWorkItemProjectOrigin | undefined
  body: string
  parsedSlug: GitHubOwnerRepo | null
}): Promise<void> {
  if (args.item.type === 'pr') {
    const targetSlug = resolvePullRequestRepo(args.item, args.projectOrigin) ?? args.parsedSlug
    if (!targetSlug) {
      throw new Error('No GitHub repository context available for this pull request.')
    }
    const target =
      args.sourceContext?.provider === 'github'
        ? taskSourceRuntimeTarget(args.sourceContext)
        : getGitHubMutationTarget(args.item.repoId, args.projectOrigin)
    const imageContext = await captureGitHubImageContext({
      runtime: target,
      target: { kind: 'slug', ...targetSlug }
    })
    const body = args.preparation
      ? await prepareGitHubImages({
          body: args.body,
          ...args.preparation,
          context: imageContext
        })
      : args.body
    args.preparation?.signal.throwIfAborted()
    const updateArgs = {
      owner: targetSlug.owner,
      repo: targetSlug.repo,
      host: githubProjectHost(targetSlug.host),
      number: args.item.number,
      updates: { body }
    }
    const res = await gitHubSlugApiForTarget(
      imageContext.runtime,
      imageContext.rpcOptions
    ).updatePullRequestBySlug({
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
          repoId: args.item.repoId,
          sourceContext: args.sourceContext,
          type: 'pr',
          number: args.item.number
        },
        { local: false }
      )
    }
    return
  }

  await runIssueUpdate({
    preparation: args.preparation,
    repoPath: args.repoPath,
    repoId: args.item.repoId,
    sourceContext: args.sourceContext,
    projectOrigin: args.projectOrigin,
    issueRepo: args.parsedSlug,
    number: args.item.number,
    updates: { body: args.body }
  })
}

export { runPullRequestStateUpdate } from './github-work-item-state-mutations'
