import { RuntimeGitHubAttachmentCommands } from '../runtime/integrations/github/runtime-github-attachment-commands'
// E9: a cwd-less gh/glab call whose host CLI is missing must not boot a stopped default distro from
// background work (rate limits, auth status, Settings, task-source probes).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSpawnReturning } from '../../shared/__fixtures__/fake-spawned-child'
import type * as WslModule from '../wsl/discovery/distro-catalog'
import type * as BackgroundDistroGate from '../wsl/discovery/wsl-background-distro-gate'

const { spawnMock, getDefaultWslDistroMock, readWslDistroRunningStateMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getDefaultWslDistroMock: vi.fn(),
  readWslDistroRunningStateMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: spawnMock
}))

vi.mock('../wsl/discovery/distro-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof WslModule>()),
  getDefaultWslDistro: getDefaultWslDistroMock
}))

vi.mock('../wsl/discovery/wsl-background-distro-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof BackgroundDistroGate>()),
  readWslDistroRunningState: readWslDistroRunningStateMock
}))

import { ghExecFileAsync, glabExecFileAsync, setDefaultWslDistroOverride } from './runner'
import { _resetGhRateLimitBreaker } from './gh-rate-limit-breaker'
import { runAsWslExecUserAct } from '../wsl/discovery/wsl-background-exec-gate'
import {
  WslDistroStoppedError,
  WslDistroUnverifiableError
} from '../wsl/filesystem/wsl-unc-access-gate'
import { starOrca } from '../github/client/fetch/orca-star'

const originalPlatform = process.platform

const CLIS = [
  { cli: 'gh', run: () => ghExecFileAsync(['api', 'rate_limit']) },
  { cli: 'glab', run: () => glabExecFileAsync(['api', 'user']) }
] as const

function hostMissingThenWslAnswers(cli: string): void {
  spawnMock
    .mockImplementationOnce(
      fakeSpawnReturning({
        spawnError: Object.assign(new Error(`spawn ${cli} ENOENT`), { code: 'ENOENT' })
      })
    )
    .mockImplementationOnce(fakeSpawnReturning({ stdout: '{}' }))
}

function spawnedWsl(): boolean {
  return spawnMock.mock.calls.some(([program]) => program === 'wsl.exe')
}

beforeEach(() => {
  spawnMock.mockReset()
  getDefaultWslDistroMock.mockReset().mockReturnValue('Ubuntu')
  readWslDistroRunningStateMock.mockReset().mockResolvedValue('running')
  setDefaultWslDistroOverride(null)
  _resetGhRateLimitBreaker()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
})

afterEach(() => {
  _resetGhRateLimitBreaker()
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

describe.each(CLIS)('$cli default-distro fallback', ({ cli, run }) => {
  it('never starts a stopped default distro, and says it is stopped rather than missing', async () => {
    readWslDistroRunningStateMock.mockResolvedValue('stopped')
    hostMissingThenWslAnswers(cli)

    const error = await run().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(WslDistroStoppedError)
    expect(String(error)).toContain("WSL distro 'Ubuntu' is not running")
    expect(String(error)).not.toMatch(/ENOENT|not found/)
    expect(spawnedWsl()).toBe(false)
  })

  it('never starts one whose state WSL could not report', async () => {
    readWslDistroRunningStateMock.mockResolvedValue('unverifiable')
    hostMissingThenWslAnswers(cli)

    await expect(run()).rejects.toBeInstanceOf(WslDistroUnverifiableError)
    expect(spawnedWsl()).toBe(false)
  })

  it('falls back to a running default distro as before', async () => {
    hostMissingThenWslAnswers(cli)

    await expect(run()).resolves.toEqual({ stdout: '{}', stderr: '' })
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'wsl.exe',
      expect.arrayContaining(['-d', 'Ubuntu']),
      expect.anything()
    )
  })

  it('still falls back to a stopped one inside a user act for it', async () => {
    readWslDistroRunningStateMock.mockResolvedValue('stopped')
    hostMissingThenWslAnswers(cli)

    await expect(runAsWslExecUserAct('Ubuntu', run)).resolves.toEqual({ stdout: '{}', stderr: '' })
    expect(spawnedWsl()).toBe(true)
  })
})

describe('starring Orca, which is always a click', () => {
  it('may start the stopped default distro its gh lives in', async () => {
    readWslDistroRunningStateMock.mockResolvedValue('stopped')
    hostMissingThenWslAnswers('gh')

    await expect(starOrca()).resolves.toBe(true)
    expect(spawnedWsl()).toBe(true)
  })
})

it('keeps the explicit local image upload and final slug publication inside the stopped-default-distro user action', async () => {
  readWslDistroRunningStateMock.mockResolvedValue('stopped')
  const commands = new RuntimeGitHubAttachmentCommands({
    resolveRepo: async () => {
      throw new Error('Slug calls must remain ambient')
    },
    getLocalGitArgs: () => [],
    resolveHostedReviewTarget: async () => {
      throw new Error('Unexpected worktree')
    }
  })
  const target = {
    kind: 'slug' as const,
    owner: 'owner',
    repo: 'repo',
    host: 'github.com',
    wakeWslDistro: true
  }
  const caller = { identity: 'desktop:1', connectionId: 'renderer:1' }
  const answer = (stdout: string) => {
    spawnMock
      .mockImplementationOnce(
        fakeSpawnReturning({
          spawnError: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
        })
      )
      .mockImplementationOnce(fakeSpawnReturning({ stdout }))
  }
  answer('{"id":123}')
  answer('{"url":"https://github.com/user-attachments/assets/a"}')
  answer('{}')
  try {
    const uploaded = await commands.upload(
      { target, contentType: 'image/png', fileName: 'screen.png' },
      caller,
      () => Buffer.from([1])
    )
    await expect(
      commands.publish(uploaded.preparationId, target, caller, () =>
        ghExecFileAsync(['api', 'repos/owner/repo/issues'])
      )
    ).resolves.toEqual({ stdout: '{}', stderr: '' })
    expect(spawnMock.mock.calls.filter(([program]) => program === 'wsl.exe')).toHaveLength(3)
  } finally {
    commands.dispose()
  }
})
