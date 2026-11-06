import { GitHubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
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
  replaceMarkdownImageDestinations
} from '../../../../shared/github/markdown-image-destinations'
import { REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES } from '../../../../shared/remote-runtime/remote-runtime-memory-limits'
import { completeClipboardImageUpload } from '@/lib/clipboard-image-chunks'
import { callGitHubAttachmentRpc } from '@/runtime/github-attachment-rpc'

export type GitHubImageUploadContext = {
  runtime: RuntimeClientTarget
  target: GitHubAttachmentTarget
  attachmentPreparationId?: string
  rpcOptions?: Parameters<typeof callRuntimeRpc>[3]
}

export function gitHubImageContext(context: GitHubImageUploadContext): GitHubImageUploadContext {
  return context
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
  return gitHubImageContext({
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
  destinations?: ReturnType<typeof markdownImageDestinations>
  context: GitHubImageUploadContext
  update: (body: string, image?: { source: string; url: string }) => void
  signal: AbortSignal
}): Promise<string> {
  let body = args.body
  const destinations = args.destinations ?? markdownImageDestinations(body)
  const replacements = new Map<string, string>()
  const sources = [
    ...new Set(destinations.map((image) => image.source).filter(isUnresolvedGitHubImage))
  ]
  args.context.attachmentPreparationId = undefined
  if (!sources.length) {
    return body
  }
  args.signal.throwIfAborted()
  const captured = await captureGitHubImageContext(args.context)
  args.context.runtime = captured.runtime
  args.context.rpcOptions = captured.rpcOptions
  const images = new Map(sources.map((source) => [source, imageData(source)]))
  if (destinations.some((image) => isUnresolvedGitHubImage(image.source) && image.start < 0)) {
    throw new Error('This image cannot be replaced safely. Paste it again, or use an image URL.')
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
  if (args.context.target.kind === 'repo') {
    const result = await callGitHubAttachmentRpc<{ githubAttachmentSelection?: unknown }>(
      args.context.runtime,
      'repo.show',
      { repo: args.context.target.repo, includeGitHubAttachmentSelection: true },
      args.signal,
      30_000,
      args.context.rpcOptions
    )
    const selection = GitHubAttachmentRepoSelection.safeParse(result.githubAttachmentSelection)
    if (!selection.success) {
      throw new Error(
        'The Orca server could not prepare this image destination. Your draft is kept; reconnect and try again.'
      )
    }
    args.context.target = {
      ...args.context.target,
      expectedRepoSelection: selection.data,
      expectedGhAccount: selection.data.ghAccount
    }
  } else if (args.context.runtime.kind === 'local') {
    args.context.target = { ...args.context.target, wakeWslDistro: true }
  }
  for (const source of sources) {
    args.signal.throwIfAborted()
    const image = images.get(source)!
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
      return callGitHubAttachmentRpc<{ url: string; preparationId: string }>(
        args.context.runtime,
        'github.uploadAttachment',
        {
          uploadId,
          preparationId: args.context.attachmentPreparationId,
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
    if (typeof result.preparationId !== 'string' || !result.preparationId) {
      throw new Error(
        'The Orca server could not retain this image submission. Your draft is kept; try again.'
      )
    }
    args.context.attachmentPreparationId = result.preparationId
    replacements.set(source, result.url)
    body = replaceMarkdownImageDestinations(args.body, destinations, replacements)
    args.update(body, { source, url: result.url })
  }
  args.context.rpcOptions?.beforeSend?.()
  assertGitHubBodyFitsTransport(body)
  return body
}
