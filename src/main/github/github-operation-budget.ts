export type GitHubOperationBudget = { signal?: AbortSignal; deadlineAt?: number }

export function githubOperationTimeout(budget: GitHubOperationBudget, maximum = 30_000): number {
  budget.signal?.throwIfAborted()
  const remaining = budget.deadlineAt === undefined ? maximum : budget.deadlineAt - Date.now()
  if (remaining <= 0) {
    throw new Error('The GitHub image upload timed out. Try again.')
  }
  return Math.min(maximum, remaining)
}
