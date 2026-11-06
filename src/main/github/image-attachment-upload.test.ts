import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadGitHubImage } from './image-attachment-upload'

const { gh, acquire, release } = vi.hoisted(() => ({
  gh: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn()
}))
vi.mock('./gh-utils', () => ({
  ghExecFileAsync: gh,
  acquire,
  release,
  extractExecError: (error: unknown) => ({
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error)
  })
}))

const repository = {
  ownerRepo: { owner: 'octo', repo: 'images', host: 'github.com' },
  ghOptions: { host: 'github.com' }
}

describe('GitHub attachment upload', () => {
  beforeEach(() => {
    gh.mockReset()
    acquire.mockReset()
    release.mockReset()
    acquire.mockResolvedValue(undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('posts the original binary bytes to the repository host and returns its hosted URL', async () => {
    gh.mockResolvedValueOnce({ stdout: '{"id":123}' }).mockResolvedValueOnce({
      stdout: '{"url":"https://github.com/user-attachments/assets/a"}'
    })
    await expect(
      uploadGitHubImage({
        fileName: 'screen.png',
        contentType: 'image/png',
        claim: () => Buffer.from([0, 128, 255]),
        resolve: async () => repository
      })
    ).resolves.toEqual({ url: 'https://github.com/user-attachments/assets/a' })
    expect(gh.mock.calls[1][0]).toEqual([
      'api',
      '-X',
      'POST',
      'https://uploads.github.com/user-attachments/assets?name=screen.png&content_type=image%2Fpng&repository_id=123',
      '-H',
      'Content-Type: application/octet-stream',
      '-H',
      'Content-Length: 3',
      '--input',
      '-'
    ])
    expect(gh.mock.calls[1][1]).toMatchObject({
      host: 'github.com',
      idempotent: false,
      stdin: Buffer.from([0, 128, 255])
    })
  })

  it('does not claim bytes or start metadata/upload after cancellation during context resolution', async () => {
    vi.useFakeTimers()
    let finish!: (value: typeof repository) => void
    const resolve = () =>
      new Promise<typeof repository>((done) => {
        finish = done
      })
    const claim = vi.fn(() => Buffer.from([1]))
    const pending = uploadGitHubImage({
      fileName: 'screen.png',
      contentType: 'image/png',
      resolve,
      claim
    })
    const rejected = expect(pending).rejects.toThrow('interrupted')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(120_001)
    expect(release).not.toHaveBeenCalled()
    finish(repository)
    await rejected
    expect(claim).not.toHaveBeenCalled()
    expect(gh).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('refuses unsupported hosts and oversize data before uploading and never retries a rejected POST', async () => {
    const claim = vi.fn(() => Buffer.from([1]))
    await expect(
      uploadGitHubImage({
        fileName: 'screen.png',
        contentType: 'image/png',
        claim,
        resolve: async () => ({
          ...repository,
          ownerRepo: { ...repository.ownerRepo, host: 'github.example.com' }
        })
      })
    ).rejects.toThrow('unavailable on this GitHub server')
    expect(claim).not.toHaveBeenCalled()
    await expect(
      uploadGitHubImage({
        fileName: 'screen.png',
        contentType: 'image/png',
        claim: () => Buffer.alloc(10 * 1024 * 1024 + 1),
        resolve: async () => repository
      })
    ).rejects.toThrow('no larger than 10 MB')
    expect(gh).not.toHaveBeenCalled()
    gh.mockResolvedValueOnce({ stdout: '{"id":123}' }).mockRejectedValueOnce(new Error('HTTP 404'))
    await expect(
      uploadGitHubImage({
        fileName: 'screen.png',
        contentType: 'image/png',
        claim,
        resolve: async () => repository
      })
    ).rejects.toThrow('account that can write')
    expect(gh.mock.calls.map((call) => call[0][0])).toEqual(['api', 'api'])
  })

  it.each(['HTTP 500: upstream private detail', 'getaddrinfo ENOTFOUND private.proxy', '{broken'])(
    'keeps raw remote and parse failures out of the composer: %s',
    async (failure) => {
      gh.mockResolvedValueOnce({ stdout: '{"id":123}' })
      if (failure === '{broken') {
        gh.mockResolvedValueOnce({ stdout: failure })
      } else {
        gh.mockRejectedValueOnce(new Error(failure))
      }
      await expect(
        uploadGitHubImage({
          fileName: 'screen.png',
          contentType: 'image/png',
          claim: () => Buffer.from([1]),
          resolve: async () => repository
        })
      ).rejects.toThrow('Your draft is kept; check your connection and try again')
      expect(gh).toHaveBeenCalledTimes(2)
    }
  )
})
