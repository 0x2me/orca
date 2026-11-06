import { GitHubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { getRuntimeEnvironmentConnectionGeneration } from '@/store/slices/runtime-status-connection-generation'
import type { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { GitHubAttachmentTarget } from '../../../../shared/rpc-contract/github-attachment-params'
import { GITHUB_IMAGE_ATTACHMENT_CAPABILITY } from '../../../../shared/github/image-attachment'
import { replaceMarkdownImageDestinations } from '../../../../shared/github/markdown-image-destinations'
import { REMOTE_RUNTIME_MAX_INBOUND_REQUEST_JSON_BYTES } from '../../../../shared/remote-runtime/remote-runtime-memory-limits'
import { classifyGitHubImages } from './image-parser/github-image-parser'
import {
  preparedImageDestinations,
  type GitHubImagePreparation
} from '../../../../shared/github/image-parser-protocol'
import { completeClipboardImageUpload } from '@/lib/clipboard-image-chunks'
import { observeGitHubImageRepo } from './github-image-repo-observation'
import { callGitHubAttachmentRpc } from '@/runtime/github-attachment-rpc'

export type GitHubImageUploadContext = {
  runtime: RuntimeClientTarget
  target: GitHubAttachmentTarget
  repoObservation?: { repoId?: string; repoPath?: string; hostId?: string }
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
  classification?: GitHubImagePreparation
  beforeUpload?: (signal: AbortSignal, sources: readonly string[]) => Promise<void>
  context: GitHubImageUploadContext
  update: (body: string, image?: { source: string; url: string }) => void
  signal: AbortSignal
}): Promise<string> {
  const owner = new AbortController()
  const signal = AbortSignal.any([args.signal, owner.signal])
  let observation: ReturnType<typeof observeGitHubImageRepo> | undefined
  let body = args.body
  const classification = args.classification ?? (await classifyGitHubImages(body))
  const sources = classification.sources.filter((source) => source.upload)
  const destinations = preparedImageDestinations(classification)
  const replacements = new Map<string, string>()
  args.context.attachmentPreparationId = undefined
  if (!sources.length) {
    return body
  }
  signal.throwIfAborted()
  await args.beforeUpload?.(
    signal,
    sources.map((image) => image.source)
  )
  signal.throwIfAborted()
  const captured = await captureGitHubImageContext(args.context)
  args.context.runtime = captured.runtime
  args.context.rpcOptions = captured.rpcOptions
  if (sources.length) {
    const statusSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
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
      signal,
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
  const beforeSend = args.context.rpcOptions?.beforeSend
  if (args.context.target.kind === 'repo' && args.context.target.expectedRepoSelection) {
    const { useAppStore } = await import('@/store')
    signal.throwIfAborted()
    observation = observeGitHubImageRepo(
      args.context,
      args.context.target.expectedRepoSelection,
      owner,
      useAppStore,
      signal
    )
    args.context.rpcOptions = {
      ...args.context.rpcOptions,
      beforeSend: () => {
        beforeSend?.()
        observation?.check()
        signal.throwIfAborted()
      }
    }
  }
  try {
    for (const { source, upload: image } of sources) {
      signal.throwIfAborted()
      if (!image) {
        continue
      }
      const base64 = source.slice(image.base64Start)
      const stagingDeadline = Date.now() + 120_000
      const stagingSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
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
        expectedBase64Length: base64.length,
        fileName: image.fileName
      })
      const result = await completeClipboardImageUpload(base64, uploadId, stage, async () => {
        const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(135_000)])
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
          uploadSignal,
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
      signal.throwIfAborted()
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
  } finally {
    observation?.dispose()
  }
}
