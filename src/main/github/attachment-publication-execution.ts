import { AsyncLocalStorage } from 'node:async_hooks'
import type { GitHubRepoExecution } from './github-api-repository'
import type { LocalGitExecOptions } from './github-repository-identity'

type PreparedExecution = {
  repoPath: string
  connectionId: string | null
  wslDistro: string | null
  execution: GitHubRepoExecution
}
const publications = new AsyncLocalStorage<PreparedExecution>()

export function withGitHubAttachmentExecution<T>(
  scope: PreparedExecution,
  operation: () => Promise<T>
): Promise<T> {
  return publications.run(scope, operation)
}

export function hasGitHubAttachmentExecution(): boolean {
  return publications.getStore() !== undefined
}

export function preparedGitHubExecution(
  repoPath: string,
  connectionId?: string | null,
  options: LocalGitExecOptions = {}
): GitHubRepoExecution | undefined {
  const scope = publications.getStore()
  if (!scope) {
    return undefined
  }
  if (
    scope.repoPath !== repoPath ||
    scope.connectionId !== (connectionId ?? null) ||
    scope.wslDistro !== (options.wslDistro ?? null)
  ) {
    throw new Error('The GitHub image destination changed. Your draft is kept; try again.')
  }
  return scope.execution
}
