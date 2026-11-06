import { translate } from '@/i18n/i18n'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

export class GitHubDraft {
  value: string
  private update: (body: string) => void
  private key: string
  private input: string
  private controller = new AbortController()
  private pending = new Set<Promise<void>>()
  private failures: { error: unknown; reported: boolean }[] = []
  private running = false

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
        this.failures.push({ error, reported })
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
      .finally(() => this.pending.delete(pending))
    this.pending.add(pending)
  }

  async submit(
    action: (body: string, signal: AbortSignal) => Promise<void>,
    setBusy: (busy: boolean) => void
  ): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
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
        if (!failure.reported) {
          toast.error(
            failure.error instanceof Error
              ? failure.error.message
              : translate(
                  'auto.components.github.imageReadFailed',
                  'The image could not be read. Paste it again.'
                )
          )
        }
        return
      }
      setBusy(true)
      busy = true
      await action(this.value, signal)
    } catch (error) {
      if (!signal.aborted) {
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
      this.running = false
      if (busy) {
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
  const ref = useRef<GitHubDraft | null>(null)
  ref.current ??= new GitHubDraft(value, update, key)
  const draft = ref.current
  draft.sync(value, update, key)
  useEffect(() => () => draft.invalidate(), [draft])
  return draft
}
