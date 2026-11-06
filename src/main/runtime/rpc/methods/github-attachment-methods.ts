import { githubAttachmentCaller } from '../../../github/attachment-preparation-contexts'
import { defineMethod } from '../core'
import { UploadGitHubAttachment } from '../../../../shared/rpc-contract/github-attachment-params'
import { claimClipboardImageUpload } from './clipboard'

export const GITHUB_ATTACHMENT_METHODS = [
  defineMethod({
    name: 'github.uploadAttachment',
    permission: 'workspace',
    params: UploadGitHubAttachment,
    handler: (params, ctx) =>
      ctx.runtime.uploadGitHubAttachment(
        params,
        () => claimClipboardImageUpload(params.uploadId, ctx),
        ctx.signal,
        githubAttachmentCaller(ctx)
      )
  })
]
