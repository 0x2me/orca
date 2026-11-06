import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeFakeSpawn,
  createFakeSpawnedChild
} from '../../../../shared/__fixtures__/fake-spawned-child'
import type { GhExecOptions } from '../../../git/command-runner/gh-exec-file'

const { spawnMock, resolverMock, signalMock, forceMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolverMock: vi.fn(),
  signalMock: vi.fn(),
  forceMock: vi.fn()
}))
vi.mock('node:child_process', async (original) => ({ ...(await original()), spawn: spawnMock }))
vi.mock('@orca/process-host/process-tree-termination', () => ({
  signalProcessTree: signalMock,
  forceTerminateProcessTree: forceMock
}))
vi.mock('../../github-api-repository', () => ({ resolveGitHubRepoExecution: resolverMock }))
import { getPRCheckDetails } from './get-pr-check-details'
import { prCheckLogTailCache } from './check-job-log-tails'
import {
  clearGhCapabilityStateForTests,
  getGhMultiAccountCapability
} from '../../gh-capability-state'
import { clearGhAccountTokenCacheForTests } from '../../gh-account-token'

const repo = { owner: 'acme', repo: 'widgets' }
const children: ChildProcess[] = []
function spawn(): ChildProcess {
  const child = createFakeSpawnedChild(children.length + 100)
  child.kill = vi.fn(() => false)
  children.push(child)
  return child
}

describe('check details existing admission ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    children.length = 0
    spawnMock.mockReset().mockImplementation(spawn)
    resolverMock
      .mockReset()
      .mockResolvedValue({ ownerRepo: repo, ghOptions: { cwd: '/folder', env: {} } })
    signalMock.mockResolvedValue(false)
    forceMock.mockResolvedValue(false)
    clearGhCapabilityStateForTests()
    clearGhAccountTokenCacheForTests()
    prCheckLogTailCache.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    for (const child of children) {
      child.emit('close', 0, null)
    }
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not admit a fifth request after four public aborts and unverified grace', async () => {
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const results = controllers.map((controller, i) =>
      getPRCheckDetails('/folder', { checkRunId: i + 1 }, undefined, {}, controller.signal).catch(
        (error: unknown) => error
      )
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(4)
    const fifth = getPRCheckDetails('/folder', { checkRunId: 5 })
    for (const controller of controllers) {
      controller.abort('secret-reason')
    }
    await vi.advanceTimersByTimeAsync(0)
    for (const result of await Promise.all(results)) {
      expect(result).toMatchObject({
        name: 'AbortError',
        message: 'Check details request was cancelled.'
      })
    }
    await vi.advanceTimersByTimeAsync(12_000)
    expect(children).toHaveLength(4)
    children[0].emit('close', null, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(5)
    completeFakeSpawn(children[4], { stdout: '{"name":"fifth"}' })
    await vi.advanceTimersByTimeAsync(0)
    completeFakeSpawn(children[5], { stdout: '[]' })
    await expect(fifth).resolves.toMatchObject({ name: 'fifth' })
  })

  it('keeps four actual log captures admitted after subscriber abort and grace, with no late cache publication', async () => {
    const logChildren: ChildProcess[] = []
    spawnMock.mockImplementation((_program: string, argv: string[]) => {
      const child = spawn()
      const endpoint = argv.find((arg) => arg.startsWith('repos/')) ?? ''
      if (endpoint.endsWith('/logs')) {
        logChildren.push(child)
        if (logChildren.length === 5) {
          queueMicrotask(() => completeFakeSpawn(child, { stdout: 'Error: fifth' }))
        }
      } else {
        const id = children.length
        queueMicrotask(() =>
          completeFakeSpawn(child, {
            stdout: JSON.stringify({
              jobs: [
                {
                  id,
                  name: 'job',
                  status: 'completed',
                  conclusion: 'failure',
                  completed_at: 'done'
                }
              ]
            })
          })
        )
      }
      return child
    })
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const results = controllers.map((controller, i) =>
      getPRCheckDetails(
        '/folder',
        { workflowRunId: i + 1 },
        undefined,
        {},
        controller.signal
      ).catch(() => null)
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(logChildren).toHaveLength(4)
    const fifth = getPRCheckDetails('/folder', { workflowRunId: 5 })
    for (const controller of controllers) {
      controller.abort()
    }
    await Promise.all(results)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(logChildren).toHaveLength(4)
    expect(prCheckLogTailCache.size).toBe(0)
    logChildren[0].emit('close', null, 'SIGKILL')
    await vi.advanceTimersByTimeAsync(0)
    await expect(fifth).resolves.toMatchObject({ jobs: [{ logTail: 'Error: fifth' }] })
    expect(logChildren).toHaveLength(5)
  })

  it('prevents the jobs stage after a swallowed annotation PID error until close', async () => {
    const controller = new AbortController()
    const result = getPRCheckDetails(
      '/folder',
      { checkRunId: 1, workflowRunId: 2 },
      undefined,
      {},
      controller.signal
    )
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    completeFakeSpawn(children[0], { stdout: '{"name":"loaded"}' })
    await vi.advanceTimersByTimeAsync(0)
    children[1].emit('error', new Error('private-output'))
    await vi.advanceTimersByTimeAsync(0)
    expect(children).toHaveLength(2)
    controller.abort()
    await rejected
    expect(children).toHaveLength(2)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-output')
  })

  it.each(['close', 'error-before-close'])(
    'retains cancelled creators through shared help %s without starting abandoned token children',
    async (ending) => {
      signalMock.mockClear()
      const options: GhExecOptions = {
        cwd: '/folder',
        ghAccount: { host: 'github.com', user: 'Alice' },
        env: {}
      }
      resolverMock.mockResolvedValue({ ownerRepo: repo, ghOptions: options })
      const controllers = Array.from({ length: 4 }, () => new AbortController())
      const results = controllers.map((controller) =>
        getPRCheckDetails('/folder', { checkRunId: 1 }, undefined, {}, controller.signal).catch(
          (error: unknown) => error
        )
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([['auth', 'token', '--help']])
      const liveCapability = getGhMultiAccountCapability({ cwd: '/folder' })
      for (const controller of controllers) {
        controller.abort()
      }
      for (const result of await Promise.all(results)) {
        expect(result).toMatchObject({ name: 'AbortError' })
      }
      resolverMock.mockResolvedValue({ ownerRepo: repo, ghOptions: { cwd: '/folder', env: {} } })
      const fifth = getPRCheckDetails('/folder', { checkRunId: 5 })
      void fifth.catch(() => {})
      await vi.advanceTimersByTimeAsync(9_000)
      // Public departure does not release permits while the shared child still owns its termination receipt.
      expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([['auth', 'token', '--help']])
      expect(signalMock).not.toHaveBeenCalled()
      if (ending === 'error-before-close') {
        children[0].emit('error', new Error('private-output'))
        await vi.advanceTimersByTimeAsync(0)
        expect(spawnMock.mock.calls.map((call) => call[1])).toEqual([['auth', 'token', '--help']])
        expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-output')
      }
      completeFakeSpawn(children[0], { stdout: '--user' })
      await expect(liveCapability).resolves.toBe(ending === 'close' ? 'supported' : 'unknown')
      await vi.advanceTimersByTimeAsync(0)
      expect(children).toHaveLength(2)
      expect(spawnMock.mock.calls[1][1]).toContain('repos/acme/widgets/check-runs/5')
      completeFakeSpawn(children[1], { stdout: '{"name":"fifth"}' })
      await vi.advanceTimersByTimeAsync(0)
      expect(spawnMock.mock.calls[2][1]).toContain(
        'repos/acme/widgets/check-runs/5/annotations?per_page=20'
      )
      completeFakeSpawn(children[2], { stdout: '[]' })
      await expect(fifth).resolves.toMatchObject({ name: 'fifth' })
      await expect(getGhMultiAccountCapability({ cwd: '/folder' })).resolves.toBe(
        ending === 'close' ? 'supported' : 'unknown'
      )
      expect(spawnMock.mock.calls.map((call) => call[1][0])).toEqual(['auth', 'api', 'api'])
    }
  )
})
