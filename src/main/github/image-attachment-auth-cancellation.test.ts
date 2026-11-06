import type * as ChildProcess from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import {
  completeFakeSpawn,
  createFakeSpawnedChild
} from '../../shared/__fixtures__/fake-spawned-child'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  spawn
}))

import { uploadGitHubImage } from './image-attachment-upload'
import { clearGhCapabilityStateForTests } from './gh-capability-state'
import { clearGhAccountTokenCacheForTests } from './gh-account-token'
import { _resetGhRateLimitBreaker } from '../git/gh-rate-limit-breaker'

afterEach(() => {
  vi.restoreAllMocks()
  clearGhCapabilityStateForTests()
  clearGhAccountTokenCacheForTests()
  _resetGhRateLimitBreaker()
})

it('settles an aborted bound-token child before releasing an upload, then allows a fresh authenticated attempt', async () => {
  clearGhCapabilityStateForTests()
  clearGhAccountTokenCacheForTests()
  _resetGhRateLimitBreaker()
  // Every process here is synthetic; cancellation must never signal an operating-system PID.
  vi.spyOn(process, 'kill').mockReturnValue(true)
  const tokenStarted = Promise.withResolvers<ReturnType<typeof createFakeSpawnedChild>>()
  let tokenCalls = 0
  const commands: string[][] = []
  spawn.mockImplementation((_program: string, args: string[]) => {
    commands.push([...args])
    const child = createFakeSpawnedChild()
    if (args[0] === 'auth' && !args.includes('--help')) {
      tokenCalls++
      if (tokenCalls === 1) {
        tokenStarted.resolve(child)
        return child
      }
    }
    const stdout = args.includes('--help')
      ? 'Usage: gh auth token [--user login]'
      : args[0] === 'auth'
        ? 'synthetic-token'
        : args.includes('POST')
          ? '{"url":"https://github.com/user-attachments/assets/image"}'
          : '{"id":123}'
    queueMicrotask(() => completeFakeSpawn(child, { stdout }))
    return child
  })
  const controller = new AbortController()
  const upload = (signal?: AbortSignal) =>
    uploadGitHubImage({
      signal,
      fileName: 'screen.png',
      contentType: 'image/png',
      claim: () => Buffer.from([1]),
      resolve: async () => ({
        ownerRepo: { owner: 'owner', repo: 'repo', host: 'github.com' },
        ghOptions: { host: 'github.com', ghAccount: { host: 'github.com', user: 'test-user' } }
      })
    })
  let settled = false
  const pending = upload(controller.signal).finally(() => {
    settled = true
  })
  const rejected = expect(pending).rejects.toThrow('interrupted')
  const tokenChild = await tokenStarted.promise
  controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(commands.some((args) => args.includes('POST'))).toBe(false)
  tokenChild.emit('exit', null, 'SIGTERM')
  tokenChild.emit('close', null, 'SIGTERM')
  await rejected
  expect(commands.some((args) => args.includes('POST'))).toBe(false)
  await expect(upload()).resolves.toEqual({
    url: 'https://github.com/user-attachments/assets/image'
  })
  expect(tokenCalls).toBe(2)
})
