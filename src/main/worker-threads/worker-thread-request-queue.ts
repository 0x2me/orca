import { LazyWorkerThreadHost } from './lazy-worker-thread-host'
import type {
  WorkerThreadRequestQueueOptions,
  WorkerThreadRequestOwner,
  OwnerFailures,
  PendingCall
} from './worker-thread-request-options'
export type {
  WorkerThreadRequestQueueOptions,
  WorkerThreadRequestOwner
} from './worker-thread-request-options'

/** Serialize worker calls; failures must never move their work onto the main thread. */

export class WorkerThreadRequestQueue<
  TRequest extends { id: number },
  TResponse extends { id: number }
> {
  private active: PendingCall<TRequest, TResponse> | null = null
  private queue: PendingCall<TRequest, TResponse>[] = []
  private consecutiveDeaths = 0
  private readonly ownerFailures = new WeakMap<WorkerThreadRequestOwner, OwnerFailures>()
  private nextId = 1
  private disposed = false
  private awaitingRetirement = false
  private readonly host: LazyWorkerThreadHost<TResponse>

  constructor(private readonly options: WorkerThreadRequestQueueOptions<TRequest>) {
    this.host = new LazyWorkerThreadHost<TResponse>({
      factory: options.factory,
      idleTeardownMs: options.idleTeardownMs,
      onMessage: (response) => this.onMessage(response),
      onError: (error) => this.onWorkerFault(error),
      onExit: (code) => this.onWorkerExit(code),
      isIdle: () => !this.active && this.queue.length === 0,
      onUnavailable: options.onUnavailable,
      awaitRetirement: options.awaitRetirement
    })
  }

  /** By default timeout starts at dispatch; enqueueBudget includes the entire queue wait. */
  dispatch(
    buildRequest: (id: number) => TRequest,
    timeoutMs: number,
    signal?: AbortSignal,
    owner?: WorkerThreadRequestOwner,
    retainedBytes = 0
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error('Worker request queue disposed'))
        return
      }
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('Worker request aborted'))
        return
      }
      const refused = owner && this.ownerFailures.get(owner)?.refused
      if (refused) {
        reject(refused)
        return
      }
      const budget = this.options.enqueueBudget
      const id = this.nextId++
      // Existing callers retain eager construction; byte-budget callers construct only at dispatch.
      const request = budget ? undefined : buildRequest(id)
      const cap = this.options.queueCap
      const direct = !this.active && this.queue.length === 0 && !this.host.isRetiring
      if (
        (cap && this.queue.length >= cap.maxQueuedCalls) ||
        (budget &&
          !direct &&
          this.queue.reduce((total, queued) => total + queued.retainedBytes, retainedBytes) >
            budget.maxQueuedBytes)
      ) {
        reject(
          new Error(
            budget
              ? budget.describeFull()
              : request && cap
                ? cap.describeFull(request)
                : 'Worker queue is full'
          )
        )
        return
      }
      if (timeoutMs <= 0) {
        reject(new Error(this.options.describeTimeout(timeoutMs)))
        return
      }
      // A new unowned burst must not inherit the previous burst's crash count.
      if (!owner && !this.active && this.queue.length === 0) {
        this.consecutiveDeaths = 0
      }
      const call: PendingCall<TRequest, TResponse> = {
        id,
        request,
        buildRequest: budget ? () => buildRequest(id) : undefined,
        retainedBytes,
        timeoutMs,
        resolve,
        reject,
        timer: null,
        signal,
        owner,
        cleanupAbort: () => signal?.removeEventListener('abort', abort)
      }
      const abort = (): void => {
        if (this.active === call) {
          this.host.destroy()
        } else {
          this.queue = this.queue.filter((queued) => queued !== call)
        }
        this.settle(call, () => reject(signal?.reason ?? new Error('Worker request aborted')))
        this.afterSettle()
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.queue.push(call)
      if (budget) {
        this.armDeadline(call)
      }
      this.pump()
    })
  }

  dispose(): void {
    this.disposed = true
    this.host.destroy()
    const pending = this.active ? [this.active, ...this.queue] : this.queue
    this.queue = []
    for (const call of pending) {
      this.settle(call, () => call.reject(new Error('Worker request queue disposed')))
    }
  }

  private pump(): void {
    if (this.disposed || this.active || this.queue.length === 0) {
      return
    }
    // A shared signal is already aborted before its remaining listeners run.
    while (this.queue[0]?.signal?.aborted) {
      const cancelled = this.queue.shift()
      if (cancelled) {
        this.settle(cancelled, () =>
          cancelled.reject(cancelled.signal?.reason ?? new Error('Worker request aborted'))
        )
      }
    }
    if (this.queue.length === 0) {
      this.host.scheduleIdleTeardown()
      return
    }
    const worker = this.host.ensure()
    if (!worker) {
      const retirement = this.host.retirement
      if (retirement && this.options.waitForRetirement) {
        if (!this.awaitingRetirement) {
          this.awaitingRetirement = true
          void retirement.then(() => {
            this.awaitingRetirement = false
            this.pump()
          })
        }
        return
      }
      this.failQueuedAsUnavailable()
      return
    }
    const call = this.queue.shift()
    if (!call) {
      return
    }
    this.active = call
    this.host.clearIdleTimer()
    if (!this.options.enqueueBudget) {
      this.armDeadline(call)
    }
    try {
      call.request ??= call.buildRequest?.()
      call.buildRequest = undefined
      if (!call.request) {
        throw new Error('Worker request unavailable')
      }
      worker.postMessage(call.request)
    } catch (error) {
      this.onWorkerFault(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private armDeadline(call: PendingCall<TRequest, TResponse>): void {
    if (call.timer) {
      clearTimeout(call.timer)
    }
    call.timer = setTimeout(() => this.onTimeout(call), call.timeoutMs)
    call.timer.unref?.()
  }

  private onMessage(response: TResponse): void {
    const call = this.active
    if (!call || call.id !== response.id) {
      return
    }
    if (this.options.isProgress?.(response)) {
      if (!this.options.enqueueBudget) {
        this.armDeadline(call)
      }
      return
    }
    if (call.owner) {
      this.failuresFor(call.owner).consecutiveDeaths = 0
    } else {
      this.consecutiveDeaths = 0
    }
    this.settle(call, () => call.resolve(response))
    this.afterSettle()
  }

  private onTimeout(call: PendingCall<TRequest, TResponse>): void {
    if (this.options.enqueueBudget) {
      if (this.active === call) {
        this.host.destroy()
      } else {
        this.queue = this.queue.filter((queued) => queued !== call)
      }
      this.settle(call, () => call.reject(new Error(this.options.describeTimeout(call.timeoutMs))))
      this.afterSettle()
      return
    }
    if (this.active !== call) {
      return
    }
    this.onWorkerFault(new Error(this.options.describeTimeout(call.timeoutMs)))
  }

  private onWorkerExit(code: number): void {
    // Drop cleanly exited handles so the next call cannot post to a dead worker.
    if (code === 0 && !this.active && this.queue.length === 0) {
      this.host.destroy()
      return
    }
    this.onWorkerFault(new Error(this.options.describeExit(code)))
  }

  private onWorkerFault(error: Error): void {
    const failed = this.active
    this.host.destroy()
    if (!failed) {
      this.pump()
      return
    }
    const deaths = failed.owner
      ? ++this.failuresFor(failed.owner).consecutiveDeaths
      : ++this.consecutiveDeaths
    this.settle(failed, () => failed.reject(error))
    if (deaths >= this.options.maxConsecutiveDeaths) {
      this.drainQueueAfterCrashLoop(error, failed.owner)
      return
    }
    if (this.queue.length > 0) {
      this.pump()
    }
  }

  private drainQueueAfterCrashLoop(error: Error, owner?: WorkerThreadRequestOwner): void {
    const pending = this.queue.filter((call) => call.owner === owner)
    this.queue = this.queue.filter((call) => call.owner !== owner)
    const drainError = new Error(this.options.describeCrashLoop(error.message))
    if (owner) {
      this.failuresFor(owner).refused = drainError
    } else {
      this.consecutiveDeaths = 0
    }
    for (const call of pending) {
      this.settle(call, () => call.reject(drainError))
    }
    this.afterSettle()
  }

  private failuresFor(owner: WorkerThreadRequestOwner): OwnerFailures {
    let failures = this.ownerFailures.get(owner)
    if (!failures) {
      failures = { consecutiveDeaths: 0, refused: null }
      this.ownerFailures.set(owner, failures)
    }
    return failures
  }

  private failQueuedAsUnavailable(): void {
    const pending = this.queue
    this.queue = []
    const reason = this.host.isRetiring ? 'previous worker still exiting' : 'worker spawn failed'
    for (const call of pending) {
      this.settle(call, () => call.reject(this.options.createUnavailableError(reason)))
    }
  }

  private settle(call: PendingCall<TRequest, TResponse>, run: () => void): void {
    call.cleanupAbort()
    call.request = undefined
    call.buildRequest = undefined
    if (call.timer) {
      clearTimeout(call.timer)
      call.timer = null
    }
    if (this.active === call) {
      this.active = null
    }
    run()
  }

  private afterSettle(): void {
    if (this.queue.length > 0) {
      this.pump()
    } else {
      this.host.scheduleIdleTeardown()
    }
  }
}
