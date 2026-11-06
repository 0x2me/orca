import { acquire, extractExecError, ghExecFileAsync, release } from './gh-utils'
import type { GitHubRepoExecOptions } from './github-api-repository'
import type { GitHubOwnerRepo } from '../../shared/github/pull-request-types'
import { assertGitHubImage } from '../../shared/github/image-attachment'
import { githubOperationTimeout, type GitHubOperationBudget } from './github-operation-budget'

type AttachmentRepository = { ownerRepo: GitHubOwnerRepo | null; ghOptions: GitHubRepoExecOptions }

export async function uploadGitHubImage(args: {
  fileName: string
  contentType: string
  signal?: AbortSignal
  claim: () => Buffer
  resolve: (budget: GitHubOperationBudget) => Promise<AttachmentRepository>
}): Promise<{ url: string }> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('The GitHub image upload timed out. Try again.')),
    120_000
  )
  const signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal
  const budget = { signal, deadlineAt: Date.now() + 120_000 }
  let admitted = false
  try {
    await acquire(signal)
    admitted = true
    githubOperationTimeout(budget)
    const { ownerRepo, ghOptions } = await args.resolve(budget)
    githubOperationTimeout(budget)
    if (!ownerRepo) {
      throw new Error('The GitHub repository could not be found. Reopen it and try again.')
    }
    const host = ownerRepo.host?.trim().toLowerCase() || 'github.com'
    if (host !== 'github.com' && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ghe\.com$/.test(host)) {
      throw new Error(
        'Image uploads are unavailable on this GitHub server. Use an image URL or attach the image in GitHub.'
      )
    }
    githubOperationTimeout(budget)
    const bytes = args.claim()
    assertGitHubImage(args.contentType, bytes.byteLength)
    const options = { ...ghOptions, ...budget, idempotent: false }
    const { stdout } = await ghExecFileAsync(
      ['api', `repos/${ownerRepo.owner}/${ownerRepo.repo}`],
      {
        ...options,
        timeout: githubOperationTimeout(budget)
      }
    )
    githubOperationTimeout(budget)
    const repository: { id?: number } = JSON.parse(stdout)
    if (!Number.isSafeInteger(repository.id) || (repository.id ?? 0) <= 0) {
      throw new Error('The GitHub repository could not be found. Reopen it and try again.')
    }
    const endpoint = new URL(`https://uploads.${host}/user-attachments/assets`)
    endpoint.search = new URLSearchParams({
      name: args.fileName,
      content_type: args.contentType,
      repository_id: String(repository.id)
    }).toString()
    const result = await ghExecFileAsync(
      [
        'api',
        '-X',
        'POST',
        endpoint.href,
        '-H',
        'Content-Type: application/octet-stream',
        '--input',
        '-'
      ],
      {
        ...options,
        timeout: githubOperationTimeout(budget, 120_000),
        stdin: bytes
      }
    )
    githubOperationTimeout(budget)
    const asset: { url?: string } = JSON.parse(result.stdout)
    if (
      typeof asset.url !== 'string' ||
      !asset.url.startsWith(`https://${host}/user-attachments/`)
    ) {
      throw new Error('GitHub did not return an image URL. Your draft is kept; try again.')
    }
    return { url: asset.url }
  } catch (error) {
    if (signal.aborted) {
      throw new Error('The GitHub image upload was interrupted. Your draft is kept; try again.')
    }
    const { stdout, stderr } = extractExecError(error)
    const text = `${stdout}\n${stderr}`
    if (/\b(?:403|404)\b/.test(text)) {
      throw new Error(
        'GitHub could not upload the image with this account. Use an image URL or attach it in GitHub with an account that can write to this repository.'
      )
    }
    if (/\b429\b/.test(text)) {
      throw new Error('GitHub is limiting image uploads. Your draft is kept; try again later.')
    }
    if (/\b422\b/.test(text)) {
      throw new Error(
        'GitHub could not accept the image. Try a smaller image, or attach it in GitHub.'
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (admitted) {
      release()
    }
  }
}
