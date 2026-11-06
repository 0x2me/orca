import { prepareGitHubImages, captureGitHubRepoImageContext } from './prepare-github-images'
export type GitHubDraftPreparation = { signal: AbortSignal; update: (body: string) => void }
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { GhAccountBinding } from '../../../../shared/github/account-binding'
import { GITHUB_ACCOUNT_EXPECTATION_RUNTIME_CAPABILITY } from '../../../../shared/task-source-runtime-capabilities'
import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status-connection-generation'
import { RUNTIME_CONNECTION_CHANGED_MESSAGE } from '@/web/web-runtime-request-registry'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { emitGitHubWorkItemDetailsCacheMutation } from '@/lib/github-work-item-details-cache-events'
import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'

type GitHubCommentRepo = {
  preparation?: GitHubDraftPreparation
  repoId?: string
  repoPath: string
  sourceContext?: TaskSourceContext | null
  prRepo?: GitHubOwnerRepo | null
}

export async function addIssueCommentForRepo(
  args: GitHubCommentRepo & {
    number: number
    body: string
    type?: 'issue' | 'pr'
  }
): Promise<Awaited<ReturnType<typeof window.api.gh.addIssueComment>>> {
  const imageContext = await captureGitHubRepoImageContext(
    args,
    args.type === 'pr' ? 'origin' : 'issue'
  )
  const preparedBody = args.preparation
    ? await prepareGitHubImages({
        body: args.body,
        ...args.preparation,
        context: imageContext
      })
    : args.body
  args.preparation?.signal.throwIfAborted()
  if (imageContext.runtime.kind === 'environment') {
    return callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.addIssueComment>>>(
      imageContext.runtime,
      'github.addIssueComment',
      {
        repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
        number: args.number,
        body: preparedBody,
        ...(args.type ? { type: args.type } : {}),
        prRepo: args.prRepo ?? null
      },
      { ...imageContext.rpcOptions, timeoutMs: 30_000 }
    ).then((result) => {
      if (result.ok) {
        notifyWorkItemDetailsMutation(
          {
            repoPath: args.repoPath,
            repoId: args.repoId,
            sourceContext: args.sourceContext,
            type: args.type ?? 'issue',
            number: args.number
          },
          { local: false }
        )
      }
      return result
    })
  }
  return window.api.gh.addIssueComment({
    repoPath: args.repoPath,
    repoId: args.repoId,
    sourceContext: args.sourceContext,
    number: args.number,
    body: preparedBody,
    type: args.type,
    prRepo: args.prRepo ?? null
  })
}

export async function addPRReviewCommentForRepo(
  args: GitHubCommentRepo & {
    prNumber: number
    commitId: string
    path: string
    line: number
    startLine?: number
    body: string
  }
): Promise<Awaited<ReturnType<typeof window.api.gh.addPRReviewComment>>> {
  const imageContext = await captureGitHubRepoImageContext(args, 'origin')
  const preparedBody = args.preparation
    ? await prepareGitHubImages({
        body: args.body,
        ...args.preparation,
        context: imageContext
      })
    : args.body
  args.preparation?.signal.throwIfAborted()
  if (imageContext.runtime.kind === 'environment') {
    return callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.addPRReviewComment>>>(
      imageContext.runtime,
      'github.addPRReviewComment',
      {
        repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
        prNumber: args.prNumber,
        prRepo: args.prRepo ?? null,
        commitId: args.commitId,
        path: args.path,
        line: args.line,
        startLine: args.startLine,
        body: preparedBody
      },
      { ...imageContext.rpcOptions, timeoutMs: 30_000 }
    ).then((result) => {
      if (result.ok) {
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
      return result
    })
  }
  return window.api.gh.addPRReviewComment({
    repoPath: args.repoPath,
    repoId: args.repoId,
    sourceContext: args.sourceContext,
    prNumber: args.prNumber,
    prRepo: args.prRepo ?? null,
    commitId: args.commitId,
    path: args.path,
    line: args.line,
    startLine: args.startLine,
    body: preparedBody
  })
}

export async function addPRReviewCommentReplyForRepo(
  args: GitHubCommentRepo & {
    prNumber: number
    commentId: number
    body: string
    threadId?: string
    path?: string
    line?: number
  }
): Promise<Awaited<ReturnType<typeof window.api.gh.addPRReviewCommentReply>>> {
  const imageContext = await captureGitHubRepoImageContext(args, 'origin')
  const preparedBody = args.preparation
    ? await prepareGitHubImages({
        body: args.body,
        ...args.preparation,
        context: imageContext
      })
    : args.body
  args.preparation?.signal.throwIfAborted()
  if (imageContext.runtime.kind === 'environment') {
    return callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.addPRReviewCommentReply>>>(
      imageContext.runtime,
      'github.addPRReviewCommentReply',
      {
        repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
        prNumber: args.prNumber,
        prRepo: args.prRepo ?? null,
        commentId: args.commentId,
        body: preparedBody,
        threadId: args.threadId,
        path: args.path,
        line: args.line
      },
      { ...imageContext.rpcOptions, timeoutMs: 30_000 }
    ).then((result) => {
      if (result.ok) {
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
      return result
    })
  }
  return window.api.gh.addPRReviewCommentReply({
    repoPath: args.repoPath,
    repoId: args.repoId,
    sourceContext: args.sourceContext,
    prNumber: args.prNumber,
    prRepo: args.prRepo ?? null,
    commentId: args.commentId,
    body: preparedBody,
    threadId: args.threadId,
    path: args.path,
    line: args.line
  })
}

export function notifyWorkItemDetailsMutation(
  args: {
    repoPath: string
    repoId?: string
    sourceContext?: TaskSourceContext | null
    type: 'issue' | 'pr'
    number: number
  },
  options: { local?: boolean } = {}
): void {
  if (options.local !== false) {
    emitGitHubWorkItemDetailsCacheMutation(args)
  }
  void window.api.gh
    .notifyWorkItemMutated({
      repoPath: args.repoPath,
      repoId: args.repoId,
      type: args.type,
      number: args.number
    })
    .catch(() => undefined)
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
