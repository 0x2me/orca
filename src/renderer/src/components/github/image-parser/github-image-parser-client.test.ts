import { classifyGitHubImages } from './github-image-parser'
import { afterEach, expect, it, vi } from 'vitest'
import { GitHubImageParserClient } from './github-image-parser-client'
import type {
  GitHubImageParseRequest,
  GitHubImageParseResponse
} from '../../../../../shared/github/image-parser-protocol'

class WorkerFixture {
  onmessage: ((event: MessageEvent<GitHubImageParseResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  posted: GitHubImageParseRequest[] = []
  terminated = false
  postMessage(request: GitHubImageParseRequest) {
    this.posted.push(request)
  }
  terminate() {
    this.terminated = true
  }
  respond() {
    const request = this.posted.at(-1)
    if (!request) {
      throw new Error('Missing posted request')
    }
    this.onmessage?.(
      new MessageEvent('message', {
        data: { id: request.id, ok: true, result: { kind: 'validate', error: null } }
      })
    )
  }
}
const input = { kind: 'validate' as const, body: '<!-- template -->' }
function fixture() {
  const workers: WorkerFixture[] = []
  const client = new GitHubImageParserClient(() => {
    const worker = new WorkerFixture()
    workers.push(worker)
    return worker
  })
  return { client, workers }
}
const rejected = (promise: Promise<unknown>) => promise.catch((error: unknown) => error)
afterEach(() => vi.useRealTimers())

it('cancels queued work without posting and terminates active work while preserving a successor and ignoring late results', async () => {
  const { client, workers } = fixture()
  const active = new AbortController()
  const queued = new AbortController()
  const first = rejected(client.request(input, { signal: active.signal }))
  const abandoned = rejected(client.request(input, { signal: queued.signal }))
  const successor = client.request(input)
  const late = workers[0].onmessage
  queued.abort()
  await expect(abandoned).resolves.toBeInstanceOf(Error)
  expect(workers[0].terminated).toBe(false)
  active.abort()
  await expect(first).resolves.toBeInstanceOf(Error)
  expect(workers[0].terminated).toBe(true)
  expect(workers[1].posted.map((request) => request.id)).toEqual([3])
  late?.(
    new MessageEvent('message', {
      data: { id: 1, ok: true, result: { kind: 'validate', error: null } }
    })
  )
  workers[1].respond()
  await expect(successor).resolves.toEqual({ kind: 'validate', error: null })
  client.dispose()
})

it('counts queue wait against the deadline and lets unrelated jobs survive an active deadline', async () => {
  vi.useFakeTimers()
  const { client, workers } = fixture()
  const first = rejected(client.request(input, { deadlineAt: Date.now() + 1_000 }))
  const short = rejected(client.request(input, { deadlineAt: Date.now() + 500 }))
  const survivor = client.request(input)
  await vi.advanceTimersByTimeAsync(500)
  await expect(short).resolves.toBeInstanceOf(Error)
  expect(workers[0].posted).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(500)
  await expect(first).resolves.toBeInstanceOf(Error)
  workers[1].respond()
  await expect(survivor).resolves.toEqual({ kind: 'validate', error: null })
  client.dispose()
})

it('bounds waiting inputs by bytes and count, disposes all owners, and admits oversized idle work', async () => {
  const { client, workers } = fixture()
  const large = { kind: 'prepare' as const, body: 'x'.repeat(33 * 1024 * 1024) }
  const active = rejected(client.request(large))
  expect(workers[0].posted[0].kind).toBe('prepare')
  await expect(client.request(large)).rejects.toThrow('draft is kept')
  const pending = Array.from({ length: 4 }, () => rejected(client.request(input)))
  await expect(client.request(input)).rejects.toThrow('draft is kept')
  client.dispose()
  for (const result of await Promise.all([active, ...pending])) {
    expect(result).toBeInstanceOf(Error)
  }
  expect(workers[0].terminated).toBe(true)
  await expect(client.request(input)).rejects.toThrow('draft is kept')
})

it('fails unavailable workers honestly and tears an idle worker down without poisoning a fresh request', async () => {
  const unavailable = new GitHubImageParserClient(() => {
    throw new Error('private worker failure')
  })
  await expect(unavailable.request(input)).rejects.toThrow('draft is kept')
  unavailable.dispose()
  vi.useFakeTimers()
  const { client, workers } = fixture()
  const first = client.request(input)
  workers[0].respond()
  await first
  await vi.advanceTimersByTimeAsync(60_000)
  expect(workers[0].terminated).toBe(true)
  const next = client.request(input)
  workers[1].respond()
  await expect(next).resolves.toEqual({ kind: 'validate', error: null })
  client.dispose()
})

it('admits ordinary text without creating or posting a worker job', async () => {
  const factory = vi.fn()
  vi.stubGlobal('Worker', factory)
  try {
    await expect(classifyGitHubImages('An ordinary description.')).resolves.toEqual({
      sources: [],
      destinations: []
    })
    expect(factory).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
