import { BrowserImageParserFixture } from '../../../../shared/github/__fixtures__/image-parser-worker-fixture'
import * as imageDestinations from '../../../../shared/github/markdown-image-parser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubDraft } from './use-github-draft'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/runtime-environment-revision'
import { prepareGitHubImages, captureGitHubImageContext } from './prepare-github-images'

const { rpc, errorToast } = vi.hoisted(() => ({ rpc: vi.fn(), errorToast: vi.fn() }))
vi.mock('@/runtime/github-attachment-rpc', () => ({ callGitHubAttachmentRpc: rpc }))
vi.mock('sonner', () => ({ toast: { error: errorToast } }))

const repoSelection = {
  id: 'repo',
  path: '/folder-workspace',
  issueSourcePreference: 'auto',
  connectionId: null,
  executionHostId: null,
  wslDistro: null,
  ghAccount: null
}
const context = {
  runtime: { kind: 'local' as const },
  target: { kind: 'repo' as const, repo: 'repo', source: 'issue' as const }
}
const first = '![a](data:image/png;base64,AA==)'
const second = '![b](data:image/png;base64,AQ==)'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('GitHub image submission', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', BrowserImageParserFixture)
    rpc.mockReset()
    errorToast.mockReset()
    rpc.mockImplementation(async (_target, method) => {
      if (method === 'status.get') {
        return { capabilities: ['github.image-attachments.v1'] }
      }
      if (method === 'repo.show') {
        return { githubAttachmentSelection: repoSelection }
      }
      if (method === 'clipboard.startImageUpload') {
        return { uploadId: 'upload' }
      }
      if (method === 'github.uploadAttachment') {
        return { url: 'https://github.com/user-attachments/assets/a', preparationId: 'prepared' }
      }
      return {}
    })
  })

  it('keeps completed URLs and unresolved bytes after a later failure, then retries only the unresolved image', async () => {
    let value = `${first}\n${second}`
    const draft = new GitHubDraft(
      value,
      (body) => {
        value = body
      },
      'repo'
    )
    let uploads = 0
    rpc.mockImplementation(async (_target, method) => {
      if (method === 'status.get') {
        return { capabilities: ['github.image-attachments.v1'] }
      }
      if (method === 'repo.show') {
        return { githubAttachmentSelection: repoSelection }
      }
      if (method === 'clipboard.startImageUpload') {
        return { uploadId: 'upload' }
      }
      if (method === 'github.uploadAttachment') {
        uploads++
        if (uploads === 2) {
          throw new Error('GitHub unavailable')
        }
        return {
          preparationId: 'prepared',
          url:
            uploads === 1
              ? 'https://github.com/user-attachments/assets/a'
              : 'https://github.com/user-attachments/assets/b'
        }
      }
      return {}
    })
    const publish = vi.fn()
    const submit = () =>
      draft.submit(
        async (body, signal) => {
          const ready = await prepareGitHubImages({ body, context, signal, update: draft.change })
          await publish(ready)
        },
        () => {}
      )
    await submit()
    expect(value).toBe(`![a](https://github.com/user-attachments/assets/a)\n${second}`)
    expect(publish).not.toHaveBeenCalled()
    await submit()
    expect(value).toBe(
      '![a](https://github.com/user-attachments/assets/a)\n![b](https://github.com/user-attachments/assets/b)'
    )
    expect(publish).toHaveBeenCalledWith(
      '![a](https://github.com/user-attachments/assets/a)\n![b](https://github.com/user-attachments/assets/b)'
    )
    expect(uploads).toBe(3)
  })

  it('prepares the rendered image after HTML comment termination without changing surrounding source', async () => {
    const update = vi.fn()
    const body = '<!-- comment --!><img src="data:image/png;base64,YQ==">'
    const ready = await prepareGitHubImages({
      body,
      context,
      signal: new AbortController().signal,
      update
    })
    expect(ready).toBe('<!-- comment --!><img src="https://github.com/user-attachments/assets/a">')
    expect(update).toHaveBeenCalledWith(
      '<!-- comment --!><img src="https://github.com/user-attachments/assets/a">',
      {
        source: 'data:image/png;base64,YQ==',
        url: 'https://github.com/user-attachments/assets/a'
      }
    )
  })

  it('preflights all images before upload and never fetches an arbitrary blob or local path', async () => {
    await expect(
      prepareGitHubImages({
        body: `${first}\n![b](data:image/png;base64,!)`,
        context,
        signal: new AbortController().signal,
        update: vi.fn()
      })
    ).rejects.toThrow('Paste it again')
    await expect(
      prepareGitHubImages({
        body: '![b](blob:https://orca/id)',
        context,
        signal: new AbortController().signal,
        update: vi.fn()
      })
    ).rejects.toThrow('Paste it again')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('drains accepted reads, including another paste accepted while submit is waiting, before disabling or taking a snapshot', async () => {
    const draft = new GitHubDraft('', () => {}, 'repo')
    const a = deferred<void>()
    const b = deferred<void>()
    draft.read(async () => {
      await a.promise
      draft.change(first)
    })
    const busy = vi.fn()
    const publish = vi.fn()
    const attempt = draft.submit(async (body) => {
      publish(body)
    }, busy)
    draft.read(async () => {
      await b.promise
      draft.change(`${first}\n${second}`)
    })
    await draft.submit(publish, busy)
    expect(busy).not.toHaveBeenCalled()
    a.resolve()
    await Promise.resolve()
    expect(publish).not.toHaveBeenCalled()
    b.resolve()
    await attempt
    expect(publish).toHaveBeenCalledWith(`${first}\n${second}`)
  })

  it('retains the prepared draft after the final write fails and prevents stale reads from publishing after reset', async () => {
    let value = first
    const draft = new GitHubDraft(
      value,
      (body) => {
        value = body
      },
      'repo'
    )
    await draft.submit(
      async (body, signal) => {
        await prepareGitHubImages({ body, context, signal, update: draft.change })
        throw new Error('Issue create failed')
      },
      () => {}
    )
    expect(value).toBe('![a](https://github.com/user-attachments/assets/a)')
    const read = deferred<void>()
    draft.read(async (signal) => {
      await read.promise
      signal.throwIfAborted()
      draft.change('stale')
    })
    const publish = vi.fn()
    const pending = draft.submit(publish, () => {})
    draft.sync('', () => {}, 'replacement')
    const replacement = deferred<void>()
    const busy = vi.fn()
    const successor = draft.submit(async (body) => {
      publish(body)
      await replacement.promise
    }, busy)
    read.resolve()
    await pending
    await draft.submit(async () => {
      publish('duplicate')
    }, busy)
    expect(publish).toHaveBeenCalledExactlyOnceWith('')
    expect(busy.mock.calls).toEqual([[true]])
    replacement.resolve()
    await successor
    expect(busy.mock.calls).toEqual([[true], [false]])
    expect(draft.value).toBe('')
  })

  it('keeps the draft and stops publication when a paired host changes during upload', async () => {
    replaceRuntimeEnvironmentRevisions([{ id: 'image-host', createdAt: 1, pairingRevision: 1 }])
    const captured = await captureGitHubImageContext({
      ...context,
      runtime: { kind: 'environment', environmentId: 'image-host' }
    })
    rpc.mockImplementation(async (_target, method) => {
      if (method === 'status.get') {
        return { runtimeId: 'original', capabilities: ['github.image-attachments.v1'] }
      }
      if (method === 'repo.show') {
        return { githubAttachmentSelection: repoSelection }
      }
      if (method === 'clipboard.startImageUpload') {
        return { uploadId: 'upload' }
      }
      if (method === 'github.uploadAttachment') {
        replaceRuntimeEnvironmentRevisions([{ id: 'image-host', createdAt: 2, pairingRevision: 2 }])
        return {
          url: 'https://github.com/user-attachments/assets/old-host',
          preparationId: 'prepared'
        }
      }
      return {}
    })
    const update = vi.fn()
    await expect(
      prepareGitHubImages({
        body: first,
        context: captured,
        signal: new AbortController().signal,
        update
      })
    ).rejects.toThrow('connection changed')
    expect(update).not.toHaveBeenCalled()
    expect(captured.rpcOptions?.expectedEnvironmentRuntimeId).toBe('original')
  })

  it.each([2, 20])(
    'uploads each of %i distinct image records once despite repeated references',
    async (count) => {
      // Each required output is one hosted URL per distinct source, independent of reference count.
      const images = Array.from(
        { length: count },
        (_, index) => `![image](data:image/png;base64,${Buffer.from([index]).toString('base64')})`
      )
      const body = images.concat(images, images).join('\n')
      const parse = vi.spyOn(imageDestinations, 'markdownImageDestinations')
      const ready = await prepareGitHubImages({
        body,
        context,
        signal: new AbortController().signal,
        update: () => {}
      })
      expect(rpc.mock.calls.filter((call) => call[1] === 'github.uploadAttachment')).toHaveLength(
        count
      )
      // The output needs one source scan, not another AST for every uploaded asset.
      expect(parse).toHaveBeenCalledTimes(1)
      parse.mockRestore()
      expect(ready).not.toContain('data:')
      expect(ready.match(/https:\/\/github.com\/user-attachments\/assets\/a/g)).toHaveLength(
        count * 3
      )
    }
  )

  it('does not send bytes to a server without attachment capability', async () => {
    rpc.mockResolvedValue({ capabilities: [] })
    await expect(
      prepareGitHubImages({
        body: first,
        context,
        signal: new AbortController().signal,
        update: vi.fn()
      })
    ).rejects.toThrow('Update it')
    expect(rpc.mock.calls.map((call) => call[1])).toEqual(['status.get'])
  })

  it('allows the first corrected submit after an already reported read failure', async () => {
    const draft = new GitHubDraft('', () => {}, 'repo')
    draft.read(async () => {
      throw new Error('Unsupported image')
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(errorToast).toHaveBeenCalledWith('Unsupported image')
    draft.change('Corrected comment')
    const publish = vi.fn()
    await draft.submit(publish, () => {})
    expect(publish).toHaveBeenCalledWith('Corrected comment', expect.any(AbortSignal))
    expect(errorToast).toHaveBeenCalledTimes(1)
  })
})
