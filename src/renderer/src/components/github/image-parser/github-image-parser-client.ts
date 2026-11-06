import {
  GITHUB_IMAGE_PARSE_FAILED,
  GITHUB_IMAGE_PARSE_QUEUE_BYTES,
  GITHUB_IMAGE_PARSE_TIMEOUT_MS,
  GitHubImageClassificationError,
  gitHubImageParseInputUnits,
  type GitHubImageParseInput,
  type GitHubImageParseRequest,
  type GitHubImageParseResponse,
  type GitHubImageParseResult
} from '../../../../../shared/github/image-parser-protocol'

type Transport = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>
type Job = {
  id: number
  input?: GitHubImageParseInput
  units: number
  resolve: (result: GitHubImageParseResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

/** One lazy worker belongs to this document, with reference-only bounded waiting inputs. */
export class GitHubImageParserClient {
  private worker: Transport | null = null
  private active: Job | undefined
  private queue: Job[] = []
  private nextId = 0
  private closed = false
  private deaths = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly factory: () => Transport) {}

  request(
    input: GitHubImageParseInput,
    options: { signal?: AbortSignal; deadlineAt?: number } = {}
  ): Promise<GitHubImageParseResult> {
    const units = gitHubImageParseInputUnits(input)
    const direct = !this.active && !this.queue.length
    if (
      this.closed ||
      options.signal?.aborted ||
      this.queue.length >= 4 ||
      (!direct &&
        2 * this.queue.reduce((total, job) => total + job.units, units) >
          GITHUB_IMAGE_PARSE_QUEUE_BYTES)
    ) {
      return Promise.reject(new GitHubImageClassificationError())
    }
    const timeout = Math.min(
      GITHUB_IMAGE_PARSE_TIMEOUT_MS,
      (options.deadlineAt ?? Infinity) - Date.now()
    )
    if (timeout <= 0) {
      return Promise.reject(new GitHubImageClassificationError())
    }
    if (direct) {
      this.deaths = 0
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        input,
        units,
        resolve,
        reject,
        timer: setTimeout(() => this.cancel(job), timeout),
        cleanup: () => options.signal?.removeEventListener('abort', abort)
      }
      const abort = (): void => this.cancel(job)
      options.signal?.addEventListener('abort', abort, { once: true })
      this.queue.push(job)
      this.pump()
    })
  }

  dispose(): void {
    this.closed = true
    this.destroy()
    const jobs = this.active ? [this.active, ...this.queue] : this.queue
    this.queue = []
    for (const job of jobs) {
      this.settle(job, new GitHubImageClassificationError())
    }
  }

  private pump(): void {
    if (this.closed || this.active || !this.queue.length) {
      return
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    try {
      if (!this.worker) {
        const worker = this.factory()
        this.worker = worker
        worker.onmessage = (event: MessageEvent<GitHubImageParseResponse>) => {
          if (this.worker !== worker) {
            return
          }
          const job = this.active
          if (!job || job.id !== event.data.id) {
            return
          }
          this.deaths = 0
          this.settle(
            job,
            event.data.ok ? undefined : new GitHubImageClassificationError(event.data.error),
            event.data.ok ? event.data.result : undefined
          )
          this.afterSettle()
        }
        worker.onerror = () => this.fault(worker)
        worker.onmessageerror = () => this.fault(worker)
      }
      const job = this.queue.shift()
      if (!job?.input) {
        return
      }
      this.active = job
      const request: GitHubImageParseRequest = { ...job.input, id: job.id }
      this.worker.postMessage(request)
      job.input = undefined
    } catch {
      this.fault(this.worker)
    }
  }

  private fault(worker: Transport | null): void {
    if (worker !== this.worker) {
      return
    }
    this.destroy()
    if (this.active) {
      this.settle(this.active, new GitHubImageClassificationError())
    }
    if (++this.deaths >= 3 || !worker) {
      const jobs = this.queue
      this.queue = []
      for (const job of jobs) {
        this.settle(job, new GitHubImageClassificationError())
      }
    }
    this.afterSettle()
  }

  private cancel(job: Job): void {
    if (this.active === job) {
      this.destroy()
    } else {
      this.queue = this.queue.filter((queued) => queued !== job)
    }
    this.settle(job, new GitHubImageClassificationError())
    this.afterSettle()
  }

  private settle(job: Job, error?: Error, result?: GitHubImageParseResult): void {
    clearTimeout(job.timer)
    job.cleanup()
    job.input = undefined
    if (this.active === job) {
      this.active = undefined
    }
    if (error || !result) {
      job.reject(error ?? new Error(GITHUB_IMAGE_PARSE_FAILED))
    } else {
      job.resolve(result)
    }
  }

  private afterSettle(): void {
    if (this.queue.length) {
      this.pump()
    } else if (!this.closed) {
      this.idleTimer = setTimeout(() => {
        if (!this.active && !this.queue.length) {
          this.destroy()
        }
      }, 60_000)
    }
  }

  private destroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null
      this.worker.terminate()
      this.worker = null
    }
  }
}
