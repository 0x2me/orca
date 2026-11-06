import type { ZodType } from 'zod'
import { defineMethod, type RpcTypedMethod } from '../core'
import { githubAttachmentCaller } from '../../../github/attachment-preparation-contexts'
import type { GitHubAttachmentTarget } from '../../../../shared/rpc-contract/github-attachment-params'

type PublicationTarget = { target: GitHubAttachmentTarget; worktree?: string }

export function defineGitHubBodyMethod<TName extends string, TSchema extends ZodType, TResult>(
  definition: RpcTypedMethod<TName, TSchema, TResult> & {
    attachmentTarget: (
      params: Parameters<RpcTypedMethod<TName, TSchema, TResult>['handler']>[0]
    ) => PublicationTarget
  }
) {
  return defineMethod({
    ...definition,
    handler: (params, context) => {
      const id =
        params && typeof params === 'object' && 'attachmentPreparationId' in params
          ? params.attachmentPreparationId
          : undefined
      if (typeof id !== 'string') {
        return definition.handler(params, context)
      }
      const { target, worktree } = definition.attachmentTarget(params)
      return context.runtime.withGitHubAttachmentPreparation(
        id,
        target,
        githubAttachmentCaller(context),
        async () => definition.handler(params, context),
        worktree
      )
    }
  })
}
