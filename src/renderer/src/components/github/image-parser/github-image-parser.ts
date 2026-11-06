import { mayContainGitHubImage } from '../../../../../shared/github/markdown-image-destinations'
import {
  GitHubImageClassificationError,
  type GitHubImagePreparation
} from '../../../../../shared/github/image-parser-protocol'
import { GitHubImageParserClient } from './github-image-parser-client'

let client: GitHubImageParserClient | undefined
function service(): GitHubImageParserClient {
  client ??= new GitHubImageParserClient(
    () =>
      new Worker(new URL('./github-image-parser.worker.ts', import.meta.url), { type: 'module' })
  )
  return client
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    client?.dispose()
    client = undefined
  })
}

/** Draft-only invalidation cannot cancel classification of an accepted text/HTTP action. */
export async function classifyGitHubImages(body: string): Promise<GitHubImagePreparation> {
  if (!mayContainGitHubImage(body)) {
    return { sources: [], destinations: [] }
  }
  const result = await service().request({ kind: 'prepare', body })
  if (result.kind !== 'prepare') {
    throw new GitHubImageClassificationError()
  }
  return result.preparation
}

export async function indexGitHubEditorHtml(values: string[], signal: AbortSignal) {
  if (!values.length) {
    return []
  }
  const result = await service().request({ kind: 'html', values }, { signal })
  signal.throwIfAborted()
  if (result.kind !== 'html') {
    throw new GitHubImageClassificationError()
  }
  return result.images
}
