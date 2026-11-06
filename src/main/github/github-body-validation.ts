import { existsSync } from 'node:fs'
import { GitHubImageValidationError } from '../../shared/github/image-attachment'
import { mayContainGitHubImage } from '../../shared/github/markdown-image-destinations'
import {
  GITHUB_IMAGE_PARSE_FAILED,
  GITHUB_IMAGE_PARSE_QUEUE_BYTES,
  GITHUB_IMAGE_PARSE_TIMEOUT_MS,
  type GitHubImageParseRequest,
  type GitHubImageParseResponse
} from '../../shared/github/image-parser-protocol'
import { WorkerThreadRequestQueue } from '../worker-threads/worker-thread-request-queue'
import { spawnWorkerThread } from '../worker-threads/worker-thread-spawn'
import {
  currentWorkerEntryLayout,
  resolveWorkerThreadEntryPath
} from '../worker-threads/worker-thread-entry-path'
import { currentGitHubBodyOperation } from './attachment-publication-execution'
import type { GitHubOperationBudget } from './github-operation-budget'

function createParserQueue() {
  return new WorkerThreadRequestQueue<GitHubImageParseRequest, GitHubImageParseResponse>({
    factory: () => {
      const entry = resolveWorkerThreadEntryPath(
        currentWorkerEntryLayout(__dirname),
        'image-parser-worker-entry.js'
      )
      if (!existsSync(entry)) {
        throw new Error(GITHUB_IMAGE_PARSE_FAILED)
      }
      return spawnWorkerThread(entry)
    },
    idleTeardownMs: 60_000,
    maxConsecutiveDeaths: 3,
    queueCap: { maxQueuedCalls: 4, describeFull: () => GITHUB_IMAGE_PARSE_FAILED },
    enqueueBudget: {
      maxQueuedBytes: GITHUB_IMAGE_PARSE_QUEUE_BYTES,
      describeFull: () => GITHUB_IMAGE_PARSE_FAILED
    },
    awaitRetirement: true,
    waitForRetirement: true,
    createUnavailableError: () => new Error(GITHUB_IMAGE_PARSE_FAILED),
    describeTimeout: () => GITHUB_IMAGE_PARSE_FAILED,
    describeExit: () => GITHUB_IMAGE_PARSE_FAILED,
    describeCrashLoop: () => GITHUB_IMAGE_PARSE_FAILED,
    onUnavailable: () => {}
  })
}
let service: ReturnType<typeof createParserQueue> | undefined
process.once('exit', () => service?.dispose())

/** Validation is independent of the client and completes before any public writer effects. */
export async function gitHubBodyImageError(
  body: string | undefined,
  options: GitHubOperationBudget = {}
): Promise<string | null> {
  const operation = currentGitHubBodyOperation()
  const signals = [options.signal, operation?.signal].filter(
    (signal): signal is AbortSignal => !!signal
  )
  const signal = signals.length ? AbortSignal.any(signals) : undefined
  try {
    signal?.throwIfAborted()
    let error: string | null = null
    if (body && mayContainGitHubImage(body)) {
      const deadline = Math.min(options.deadlineAt ?? Infinity, operation?.deadlineAt ?? Infinity)
      service ??= createParserQueue()
      const result = await service.dispatch(
        (id) => ({ id, kind: 'validate', body }),
        Math.min(GITHUB_IMAGE_PARSE_TIMEOUT_MS, deadline - Date.now()),
        signal,
        undefined,
        2 * body.length
      )
      if (!result.ok || result.result.kind !== 'validate') {
        return GITHUB_IMAGE_PARSE_FAILED
      }
      error = result.result.error
    }
    signal?.throwIfAborted()
    if (!error) {
      await operation?.revalidate?.()
      signal?.throwIfAborted()
    }
    return error
  } catch (error) {
    return error instanceof GitHubImageValidationError ? error.message : GITHUB_IMAGE_PARSE_FAILED
  }
}
