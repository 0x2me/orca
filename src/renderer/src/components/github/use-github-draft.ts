import { GitHubImageClassificationError } from '../../../../shared/github/image-parser-protocol'
import { translate } from '@/i18n/i18n'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

export type GitHubPreparedImage = { source: string; url: string; body: string; attempt: object }

export class GitHubDraft {
  value: string
  private update: (body: string) => void
  private key: string
  private input: string
  private controller = new AbortController()
  private pending = new Set<Promise<void>>()
  private failures: unknown[] = []
  private running: object | undefined
  private attempt = {}
  private readListeners = new Set<() => void>()
  private prepareListeners = new Set<
    (context: { attempt: object; signal: AbortSignal; sources: readonly string[] }) => Promise<void>
  >()
  subscribeImagePreparation = (
    listener: (context: {
      attempt: object
      signal: AbortSignal
      sources: readonly string[]
    }) => Promise<void>
  ): (() => void) => {
    this.prepareListeners.add(listener)
    return () => {
      this.prepareListeners.delete(listener)
    }
  }
  prepareImages = async (signal: AbortSignal, sources: readonly string[]): Promise<void> => {
    const attempt = this.attempt
    signal.throwIfAborted()
    await Promise.all(
      [...this.prepareListeners].map((listener) => listener({ attempt, signal, sources }))
    )
    signal.throwIfAborted()
  }
  private imageListeners = new Set<(image: GitHubPreparedImage) => void>()
  onPrepared?: (body: string) => void

  hasPendingReads = (): boolean => this.pending.size > 0
  subscribeReads = (listener: () => void): (() => void) => {
    this.readListeners.add(listener)
    return () => {
      this.readListeners.delete(listener)
    }
  }
  subscribeImageReplacement = (listener: (image: GitHubPreparedImage) => void): (() => void) => {
    this.imageListeners.add(listener)
    return () => {
      this.imageListeners.delete(listener)
    }
  }
  prepared = (body: string, image?: { source: string; url: string }): void => {
    try {
      if (image) {
        this.imageListeners.forEach((listener) =>
          listener({ ...image, body, attempt: this.attempt })
        )
      }
    } finally {
      this.change(body)
      this.onPrepared?.(body)
    }
  }

  constructor(value: string, update: (body: string) => void, key: string) {
    this.value = this.input = value
    this.update = update
    this.key = key
  }

  sync(value: string, update: (body: string) => void, key: string): void {
    this.update = update
    if (key !== this.key) {
      this.invalidate()
      this.key = key
    }
    if (value !== this.input) {
      if (value !== this.value) {
        this.invalidate()
      }
      this.value = value
      this.input = value
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  change = (body: string): void => {
    this.value = body
    this.update(body)
  }

  invalidate = (): void => {
    this.running = undefined
    this.controller.abort()
    this.controller = new AbortController()
    this.pending.clear()
    this.failures = []
  }

  read(action: (signal: AbortSignal) => Promise<void>): void {
    const signal = this.controller.signal
    const pending = action(signal)
      .catch((error) => {
        if (signal.aborted) {
          return
        }
        const reported = !this.running
        if (!reported) {
          this.failures.push(error)
        }
        if (reported) {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'auto.components.github.imageReadFailed',
                  'The image could not be read. Paste it again.'
                )
          )
        }
      })
      .finally(() => {
        this.pending.delete(pending)
        this.readListeners.forEach((listener) => listener())
      })
    this.pending.add(pending)
    this.readListeners.forEach((listener) => listener())
  }

  async submit(
    action: (body: string, signal: AbortSignal) => Promise<void>,
    setBusy: (busy: boolean) => void
  ): Promise<void> {
    if (this.running) {
      return
    }
    const attempt = {}
    this.running = this.attempt = attempt
    const signal = this.controller.signal
    let busy = false
    try {
      while (this.pending.size) {
        await Promise.all(this.pending)
        signal.throwIfAborted()
      }
      signal.throwIfAborted()
      const failure = this.failures.shift()
      this.failures = []
      if (failure) {
        toast.error(
          failure instanceof Error
            ? failure.message
            : translate(
                'auto.components.github.imageReadFailed',
                'The image could not be read. Paste it again.'
              )
        )
        return
      }
      setBusy(true)
      busy = true
      await action(this.value, signal)
    } catch (error) {
      if (!signal.aborted || error instanceof GitHubImageClassificationError) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.github.imageUploadFailed',
                'The image could not be uploaded. Your draft is kept; try again.'
              )
        )
      }
    } finally {
      if (this.running === attempt) {
        this.running = undefined
      }
      if (busy && !this.running) {
        setBusy(false)
      }
    }
  }
}

export function useGitHubDraft(
  value: string,
  update: (body: string) => void,
  key: string
): GitHubDraft {
  const [draft] = useState(() => new GitHubDraft(value, update, key))
  useLayoutEffect(() => {
    draft.sync(value, update, key)
  }, [draft, value, update, key])
  useSyncExternalStore(draft.subscribeReads, draft.hasPendingReads, draft.hasPendingReads)
  useEffect(() => () => draft.invalidate(), [draft])
  return draft
}
