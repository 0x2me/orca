import { AsyncLocalStorage } from 'node:async_hooks'
import type { GitHubRepoExecution } from './github-api-repository'
import type { LocalGitExecOptions } from './github-repository-identity'
import type { GitHubOperationBudget } from './github-operation-budget'

type PreparedExecution = {
  repoPath: string
  connectionId: string | null
  wslDistro: string | null
  execution: GitHubRepoExecution
}
type BodyOperation = GitHubOperationBudget & {
  prepared?: PreparedExecution
  revalidate?: () => Promise<void>
}
const publications = new AsyncLocalStorage<BodyOperation>()

export function currentGitHubBodyOperation(): BodyOperation | undefined {
  return publications.getStore()
}

export function withGitHubBodyOperation<T>(
  scope: BodyOperation,
  operation: () => Promise<T>
): Promise<T> {
  return publications.run({ ...publications.getStore(), ...scope }, operation)
}

export function withGitHubAttachmentExecution<T>(
  scope: PreparedExecution & { revalidate?: () => Promise<void> },
  operation: () => Promise<T>
): Promise<T> {
  return withGitHubBodyOperation({ prepared: scope, revalidate: scope.revalidate }, operation)
}

export function hasGitHubAttachmentExecution(): boolean {
  return publications.getStore()?.prepared !== undefined
}

export function preparedGitHubExecution(
  repoPath: string,
  connectionId?: string | null,
  options: LocalGitExecOptions = {}
): GitHubRepoExecution | undefined {
  const scope = publications.getStore()?.prepared
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
