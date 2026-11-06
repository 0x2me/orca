import type { useAppStore } from '@/store'
import {
  getRepoExecutionHostId,
  getRepoRoutingConnectionId,
  parseExecutionHostId
} from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import {
  githubAttachmentRepoSelection,
  type GitHubAttachmentRepoSelection
} from '../../../../shared/github/attachment-repo-selection'
import type { GitHubImageUploadContext } from './prepare-github-images'

function ownedRows(repos: readonly Repo[], context: GitHubImageUploadContext): Repo[] {
  return repos.filter((row) => {
    const host = parseExecutionHostId(getRepoExecutionHostId(row))
    return context.runtime.kind === 'environment'
      ? host?.kind === 'runtime' && host.environmentId === context.runtime.environmentId
      : host?.kind !== 'runtime'
  })
}

export function findGitHubImageOperationRepo(
  repos: readonly Repo[],
  context: GitHubImageUploadContext
): Repo | null {
  if (context.target.kind !== 'repo') {
    return null
  }
  const { target, repoObservation } = context
  const rows = ownedRows(repos, context).filter((row) => {
    if (repoObservation?.repoId && row.id !== repoObservation.repoId) {
      return false
    }
    if (repoObservation?.repoPath && row.path !== repoObservation.repoPath) {
      return false
    }
    if (
      !repoObservation?.repoId &&
      !repoObservation?.repoPath &&
      row.id !== target.repo &&
      row.path !== target.repo
    ) {
      return false
    }
    return !repoObservation?.hostId || getRepoExecutionHostId(row) === repoObservation.hostId
  })
  return rows.length === 1 ? rows[0] : null
}

function observedSelection(repo: Repo): string {
  const {
    wslDistro: _wsl,
    executionHostId: _host,
    ...selection
  } = githubAttachmentRepoSelection(repo, {})
  return JSON.stringify(selection)
}

/** The server's selection disambiguates nested routes without treating its native host as a client stamp. */
export function observeGitHubImageRepo(
  context: GitHubImageUploadContext,
  selection: GitHubAttachmentRepoSelection,
  controller: AbortController,
  store: Pick<typeof useAppStore, 'getState' | 'subscribe'>,
  signal: AbortSignal
): { check: () => void; dispose: () => void } {
  let repos: readonly Repo[] | undefined
  let bound = false
  const expected = JSON.stringify({
    id: selection.id,
    path: selection.path,
    issueSourcePreference: selection.issueSourcePreference,
    connectionId: selection.connectionId,
    ghAccount: selection.ghAccount
  })
  const check = (): void => {
    const current = store.getState().repos
    if (repos === current) {
      return
    }
    repos = current
    const matches = ownedRows(current, context).filter(
      (row) =>
        row.id === selection.id &&
        row.path === selection.path &&
        getRepoRoutingConnectionId(row) === selection.connectionId &&
        (context.runtime.kind === 'environment' ||
          getRepoExecutionHostId(row) === selection.executionHostId)
    )
    const row = matches.length === 1 ? matches[0] : null
    if ((row && observedSelection(row) !== expected) || (bound && !row)) {
      controller.abort(new Error('The image destination changed. Your draft is kept; try again.'))
    }
    if (row) {
      bound = true
    }
    controller.signal.throwIfAborted()
  }
  const unsubscribe = store.subscribe(() => {
    try {
      check()
    } catch {
      /* The attempt observes the aborted signal at its next boundary. */
    }
  })
  const dispose = (): void => {
    unsubscribe()
    signal.removeEventListener('abort', dispose)
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    check()
  } catch (error) {
    dispose()
    throw error
  }
  return { check, dispose }
}
