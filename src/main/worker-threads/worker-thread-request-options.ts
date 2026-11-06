import type { WorkerThreadFactory } from './worker-thread-transport'

export type WorkerThreadRequestQueueOptions<TRequest> = {
  factory: WorkerThreadFactory
  idleTeardownMs: number
  /** Consecutive deaths after which the remaining queue is failed rather than respawned. */
  maxConsecutiveDeaths: number
  /** Omit for an unbounded queue. */
  queueCap?: { maxQueuedCalls: number; describeFull: (request: TRequest) => string }
  /** Progress messages restart the active call deadline without settling it. */
  isProgress?: (message: { id: number }) => boolean
  createUnavailableError: (message: string) => Error
  describeTimeout: (timeoutMs: number) => string
  describeExit: (code: number) => string
  describeCrashLoop: (lastError: string) => string
  /** Called only on the first spawn failure. */
  onUnavailable: (error: unknown) => void
  /** Refuse new work until the terminated worker exits; native calls can delay its exit. */
  awaitRetirement?: boolean
  /** Opt in to reference-only queueing, byte admission and deadlines that include queue wait. */
  enqueueBudget?: { maxQueuedBytes: number; describeFull: () => string }
  /** Preserve queued work and wake once the terminated worker has actually exited. */
  waitForRetirement?: boolean
}

export type WorkerThreadRequestOwner = { readonly signal: AbortSignal }

export type OwnerFailures = { consecutiveDeaths: number; refused: Error | null }

export type PendingCall<TRequest, TResponse> = {
  id: number
  request?: TRequest
  buildRequest?: () => TRequest
  retainedBytes: number
  timeoutMs: number
  resolve: (value: TResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
  signal?: AbortSignal
  owner?: WorkerThreadRequestOwner
  cleanupAbort: () => void
}
