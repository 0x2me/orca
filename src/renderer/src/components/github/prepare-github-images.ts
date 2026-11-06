import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import {
  getGitHubSourceRuntimeHost,
  getGitHubRuntimeRepoId
} from '@/lib/github-source-runtime-context'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status-connection-generation'
import type { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { GitHubAttachmentTarget } from '../../../../shared/rpc-contract/github-attachment-params'
import {
  assertGitHubImage,
  GITHUB_IMAGE_ATTACHMENT_CAPABILITY
} from '../../../../shared/github/image-attachment'
import { isValidBase64 } from '../../../../shared/rpc-contract/clipboard-params'
import {
  markdownImageDestinations,
  isUnresolvedGitHubImage,
  replaceMarkdownImageSource
} from '../../../../shared/github/markdown-image-destinations'
import { REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES } from '../../../../shared/remote-runtime/remote-runtime-memory-limits'
import { completeClipboardImageUpload } from '@/lib/clipboard-image-chunks'
import { callGitHubAttachmentRpc } from '@/runtime/github-attachment-rpc'

export type GitHubImageUploadContext = {
  runtime: RuntimeClientTarget
  target: GitHubAttachmentTarget
  rpcOptions?: Parameters<typeof callRuntimeRpc>[3]
}

export async function captureGitHubImageContext(
  context: GitHubImageUploadContext
): Promise<GitHubImageUploadContext> {
  let { runtime } = context
  const { target } = context
  let assertWebPairing = (): void => {}
  if (isWebClientLocation()) {
    const { requireActiveEnvironment, resolveEnvironment } =
      await import('@/web/preload-api/web-runtime-session')
    if (runtime.kind === 'local') {
      runtime = { kind: 'environment', environmentId: requireActiveEnvironment().id }
    }
    const environmentId = runtime.environmentId
    const environment = resolveEnvironment(environmentId)
    const revision = environment.pairingRevision ?? environment.createdAt
    assertWebPairing = () => {
      const current = resolveEnvironment(environmentId)
      if ((current.pairingRevision ?? current.createdAt) !== revision) {
        throw new Error('The paired Orca server changed. Your draft is kept; try again.')
      }
    }
  }
  if (runtime.kind === 'local') {
    return { runtime, target }
  }
  const environmentId = runtime.environmentId
  const revision = getRuntimeEnvironmentRevision(environmentId)
  const generation = getRuntimeEnvironmentConnectionGeneration(environmentId)
  return {
    runtime,
    target,
    rpcOptions: {
      expectedEnvironmentPairingRevision: revision,
      beforeSend: () => {
        assertWebPairing()
        if (
          getRuntimeEnvironmentRevision(environmentId) !== revision ||
          getRuntimeEnvironmentConnectionGeneration(environmentId) !== generation
        ) {
          throw new Error('The Orca server connection changed. Your draft is kept; try again.')
        }
      }
    }
  }
}

export async function captureGitHubRepoImageContext(
  args: {
    repoPath: string
    repoId?: string
    sourceContext?: TaskSourceContext | null
    prRepo?: GitHubOwnerRepo | null
  },
  source: 'issue' | 'origin'
): Promise<GitHubImageUploadContext> {
  const host = getGitHubSourceRuntimeHost(args.sourceContext)
  return captureGitHubImageContext({
    runtime: host ? { kind: 'environment', environmentId: host.environmentId } : { kind: 'local' },
    target: {
      kind: 'repo',
      repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId) ?? args.repoPath,
      source,
      ...(args.prRepo ? { ownerRepo: args.prRepo } : {})
    }
  })
}

function imageData(source: string): { contentType: string; base64: string; fileName: string } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(source)
  if (!match || !isValidBase64(match[2])) {
    throw new Error('This image cannot be uploaded. Paste it again, or use an image URL.')
  }
  const contentType = match[1].toLowerCase()
  const base64 = match[2]
  const bytes =
    Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  assertGitHubImage(contentType, bytes)
  return {
    contentType,
    base64,
    fileName: `image.${contentType === 'image/svg+xml' ? 'svg' : contentType.slice(6)}`
  }
}

export function assertGitHubBodyFitsTransport(body: string): void {
  // Reserve room for selectors and the authenticated request envelope.
  if (
    new TextEncoder().encode(JSON.stringify(body)).byteLength >
    REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES - 16_384
  ) {
    throw new Error('This description is too large to send. Shorten it and try again.')
  }
}

export async function prepareGitHubImages(args: {
  body: string
  context: GitHubImageUploadContext
  update: (body: string) => void
  signal: AbortSignal
}): Promise<string> {
  let body = args.body
  const sources = [
    ...new Set(
      markdownImageDestinations(body)
        .map((image) => image.source)
        .filter(isUnresolvedGitHubImage)
    )
  ]
  for (const source of sources) {
    imageData(source)
  }
  if (sources.length) {
    const statusSignal = AbortSignal.any([args.signal, AbortSignal.timeout(30_000)])
    const status = await callGitHubAttachmentRpc<RuntimeStatus>(
      args.context.runtime,
      'status.get',
      undefined,
      statusSignal,
      30_000,
      args.context.rpcOptions
    )
    if (args.context.rpcOptions) {
      args.context.rpcOptions.expectedEnvironmentRuntimeId = status.runtimeId
    }
    if (status.capabilities?.includes(GITHUB_IMAGE_ATTACHMENT_CAPABILITY) !== true) {
      throw new Error(
        'This Orca server cannot upload images yet. Update it, or use an image URL. Your draft is kept.'
      )
    }
  }
  for (const source of sources) {
    args.signal.throwIfAborted()
    const image = imageData(source)
    const stagingDeadline = Date.now() + 120_000
    const stagingSignal = AbortSignal.any([args.signal, AbortSignal.timeout(120_000)])
    const stage = <T>(method: string, params: unknown): Promise<T> =>
      callGitHubAttachmentRpc<T>(
        args.context.runtime,
        method,
        params,
        stagingSignal,
        Math.max(1, Math.min(30_000, stagingDeadline - Date.now())),
        args.context.rpcOptions
      )
    const { uploadId } = await stage<{ uploadId: string }>('clipboard.startImageUpload', {
      expectedBase64Length: image.base64.length,
      fileName: image.fileName
    })
    const result = await completeClipboardImageUpload(image.base64, uploadId, stage, async () => {
      const signal = AbortSignal.any([args.signal, AbortSignal.timeout(135_000)])
      return callGitHubAttachmentRpc<{ url: string }>(
        args.context.runtime,
        'github.uploadAttachment',
        {
          uploadId,
          target: args.context.target,
          contentType: image.contentType,
          fileName: image.fileName
        },
        signal,
        135_000,
        args.context.rpcOptions
      )
    }).catch(async (error) => {
      // A cancelled staging signal cannot clean up its unclaimed session itself.
      await callGitHubAttachmentRpc(
        args.context.runtime,
        'clipboard.abortImageUpload',
        { uploadId },
        AbortSignal.timeout(5_000),
        5_000,
        args.context.rpcOptions
      ).catch(() => {})
      throw error
    })
    args.signal.throwIfAborted()
    args.context.rpcOptions?.beforeSend?.()
    body = replaceMarkdownImageSource(body, source, result.url)
    args.update(body)
  }
  args.context.rpcOptions?.beforeSend?.()
  assertGitHubBodyFitsTransport(body)
  return body
}
