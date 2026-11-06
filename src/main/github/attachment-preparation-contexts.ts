import { randomUUID } from 'node:crypto'
import type { RpcContext } from '../runtime/rpc/core'

const IDLE_MS = 5 * 60_000
const MAX_CONTEXTS = 128
const EXPIRED = 'The GitHub image submission expired or changed. Your draft is kept; try again.'

export type GitHubAttachmentCaller = { identity: string; connectionId?: string }

export function githubAttachmentCaller(
  context: Pick<
    RpcContext,
    | 'caller'
    | 'connectionId'
    | 'clientId'
    | 'pairedDeviceId'
    | 'pairedDeviceParentId'
    | 'clientKind'
  >
): GitHubAttachmentCaller {
  if (!context.caller || (!context.connectionId && context.caller.kind !== 'local-cli')) {
    throw new Error(EXPIRED)
  }
  return {
    connectionId: context.connectionId,
    identity: JSON.stringify([
      context.caller,
      context.connectionId ?? null,
      context.clientId ?? null,
      context.pairedDeviceId ?? null,
      context.pairedDeviceParentId ?? null,
      context.clientKind ?? null
    ])
  }
}

type Entry<T> = {
  id: string
  caller: GitHubAttachmentCaller
  target: string
  value?: T
  inUse: boolean
  expiresAt: number
  timer?: ReturnType<typeof setTimeout>
}

export class GitHubAttachmentPreparations<T> {
  private entries = new Map<string, Entry<T>>()

  enter(id: string | undefined, caller: GitHubAttachmentCaller, target: string): Entry<T> {
    const now = Date.now()
    if (!id) {
      for (const candidate of this.entries.values()) {
        if (!candidate.inUse && candidate.expiresAt <= now) {
          this.retire(candidate)
        }
      }
    }
    let entry = id ? this.entries.get(id) : undefined
    if (entry && !entry.inUse && entry.expiresAt <= now) {
      this.retire(entry)
      entry = undefined
    }
    if (id && !entry) {
      throw new Error(EXPIRED)
    }
    if (entry && (entry.caller.identity !== caller.identity || entry.target !== target)) {
      this.retire(entry)
      throw new Error(EXPIRED)
    }
    if (entry?.inUse) {
      throw new Error('The GitHub image submission is already running. Try again.')
    }
    if (!entry) {
      if (this.entries.size >= MAX_CONTEXTS) {
        throw new Error(
          'Too many GitHub images are being prepared. Your draft is kept; try again shortly.'
        )
      }
      entry = { id: randomUUID(), caller, target, inUse: false, expiresAt: Date.now() + IDLE_MS }
      this.entries.set(entry.id, entry)
    }
    clearTimeout(entry.timer)
    entry.inUse = true
    return entry
  }

  finish(entry: Entry<T>): void {
    if (this.entries.get(entry.id) !== entry) {
      return
    }
    entry.inUse = false
    entry.expiresAt = Date.now() + IDLE_MS
    entry.timer = setTimeout(() => this.retire(entry), IDLE_MS)
    entry.timer.unref?.()
  }

  retire(entry: Entry<T>): void {
    clearTimeout(entry.timer)
    this.entries.delete(entry.id)
  }

  retireConnection(connectionId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.caller.connectionId === connectionId) {
        this.retire(entry)
      }
    }
  }

  assertActive(entry: Entry<T>): void {
    if (this.entries.get(entry.id) !== entry) {
      throw new Error(EXPIRED)
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer)
    }
    this.entries.clear()
  }
}
