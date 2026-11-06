import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  GitHubAttachmentPreparations,
  githubAttachmentCaller
} from './attachment-preparation-contexts'

const caller = { identity: 'desktop:one', connectionId: 'one' }
let preparations: GitHubAttachmentPreparations<{ repositoryId: number }>
beforeEach(() => {
  vi.useFakeTimers()
  preparations = new GitHubAttachmentPreparations()
})
afterEach(() => {
  preparations.dispose()
  vi.useRealTimers()
})

it('requires a transport-proven owner and isolates handles by caller, connection and requested target', () => {
  expect(() => githubAttachmentCaller({})).toThrow('expired or changed')
  expect(() => githubAttachmentCaller({ caller: { kind: 'desktop' } })).toThrow(
    'expired or changed'
  )
  for (const [otherCaller, target] of [
    [{ ...caller, identity: 'desktop:two' }, 'repo'],
    [{ ...caller, identity: 'desktop:one:replacement', connectionId: 'replacement' }, 'repo'],
    [caller, 'other-repo']
  ] as const) {
    const entry = preparations.enter(undefined, caller, 'repo')
    preparations.finish(entry)
    expect(() => preparations.enter(entry.id, otherCaller, target)).toThrow('expired or changed')
    expect(() => preparations.enter(entry.id, caller, 'repo')).toThrow('expired or changed')
  }
})

it('protects an active operation from idle expiry, refuses concurrent reuse and expires abandonment after successful settlement', async () => {
  const entry = preparations.enter(undefined, caller, 'repo')
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
  expect(() => preparations.enter(entry.id, caller, 'repo')).toThrow('already running')
  preparations.assertActive(entry)
  preparations.finish(entry)
  await vi.advanceTimersByTimeAsync(4 * 60_000)
  const next = preparations.enter(entry.id, caller, 'repo')
  preparations.finish(next)
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
  expect(() => preparations.enter(entry.id, caller, 'repo')).toThrow('expired or changed')
})

it('bounds reservations as well as idle contexts, releases them on failure and shuts down every retained owner', () => {
  const entries = Array.from({ length: 128 }, () => preparations.enter(undefined, caller, 'repo'))
  expect(() => preparations.enter(undefined, caller, 'repo')).toThrow('Too many GitHub images')
  const first = entries[0]
  preparations.retire(first)
  expect(() => preparations.assertActive(first)).toThrow('expired or changed')
  const replacement = preparations.enter(undefined, caller, 'repo')
  preparations.finish(replacement)
  preparations.dispose()
  expect(() => preparations.enter(replacement.id, caller, 'repo')).toThrow('expired or changed')
  expect(() => preparations.enter(undefined, caller, 'repo')).not.toThrow()
})
