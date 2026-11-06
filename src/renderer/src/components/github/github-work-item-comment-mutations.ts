import { prepareGitHubImages, captureGitHubRepoImageContext } from './prepare-github-images'
export type GitHubDraftPreparation = {
  signal: AbortSignal
  beforeUpload?: (signal: AbortSignal, sources: readonly string[]) => Promise<void>
  update: (body: string, image?: { source: string; url: string }) => void
}
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { emitGitHubWorkItemDetailsCacheMutation } from '@/lib/github-work-item-details-cache-events'
import { getGitHubRuntimeRepoId } from '@/lib/github-source-runtime-context'
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
  if (imageContext.attachmentPreparationId) {
    args.preparation?.signal.throwIfAborted()
  }
  if (imageContext.runtime.kind === 'environment' || imageContext.attachmentPreparationId) {
    return callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.addIssueComment>>>(
      imageContext.runtime,
      'github.addIssueComment',
      {
        repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
        number: args.number,
        body: preparedBody,
        attachmentPreparationId: imageContext.attachmentPreparationId,
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
          { local: imageContext.runtime.kind === 'local' }
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
  if (imageContext.attachmentPreparationId) {
    args.preparation?.signal.throwIfAborted()
  }
  if (imageContext.runtime.kind === 'environment' || imageContext.attachmentPreparationId) {
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
        body: preparedBody,
        attachmentPreparationId: imageContext.attachmentPreparationId
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
          { local: imageContext.runtime.kind === 'local' }
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
  if (imageContext.attachmentPreparationId) {
    args.preparation?.signal.throwIfAborted()
  }
  if (imageContext.runtime.kind === 'environment' || imageContext.attachmentPreparationId) {
    return callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.addPRReviewCommentReply>>>(
      imageContext.runtime,
      'github.addPRReviewCommentReply',
      {
        repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
        prNumber: args.prNumber,
        prRepo: args.prRepo ?? null,
        commentId: args.commentId,
        body: preparedBody,
        attachmentPreparationId: imageContext.attachmentPreparationId,
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
          { local: imageContext.runtime.kind === 'local' }
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

export { setPRFileViewedForRepo } from './github-work-item-state-mutations'
