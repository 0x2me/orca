import { useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import { githubAttachmentRepoSelection } from '../../../../shared/github/attachment-repo-selection'
import { resolveGitHubImageOperation, type GitHubImageOperation } from './github-image-operation'
import { findGitHubImageOperationRepo } from './github-image-repo-observation'

export function useGitHubRepoDraftKey(args: GitHubImageOperation): string {
  const source = args.sourceContext
  const body = args.action === 'body' ? args : undefined
  const comment = args.action === 'comment' ? args : undefined
  const project = body?.projectOrigin
  const slug = body?.parsedSlug
  const owner = body?.item.prRepo ?? comment?.prRepo
  // Only operation semantics participate; store events never rebuild these inputs.
  const input = useMemo(
    () => args,
    [
      args.action,
      args.repoPath,
      source?.provider,
      source?.hostId,
      source?.repoId,
      comment?.repoId,
      comment?.source,
      body?.item.type,
      body?.item.repoId,
      body?.item.url,
      owner?.owner,
      owner?.repo,
      owner?.host,
      project?.owner,
      project?.repo,
      project?.host,
      project?.cacheKey,
      slug?.owner,
      slug?.repo,
      slug?.host
    ]
  )
  const previous = useRef<{
    repos: ReturnType<typeof useAppStore.getState>['repos']
    input: GitHubImageOperation
    key: string
  } | null>(null)
  return useAppStore((state) => {
    const cached = previous.current
    if (cached && cached.repos === state.repos && cached.input === input) {
      return cached.key
    }
    let key = 'unresolved'
    try {
      const context = resolveGitHubImageOperation(state, input)
      const repo = findGitHubImageOperationRepo(state.repos, context)
      key = JSON.stringify([
        context.runtime,
        context.target,
        repo ? githubAttachmentRepoSelection(repo, {}) : null
      ])
    } catch {
      // An unresolved render observation never replaces the action's existing refusal.
    }
    previous.current = { repos: state.repos, input, key }
    return key
  })
}
