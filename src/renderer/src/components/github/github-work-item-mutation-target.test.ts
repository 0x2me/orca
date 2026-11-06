import { describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  state: {
    settings: { activeRuntimeEnvironmentId: 'focused-runtime' },
    repos: [
      { id: 'tracked', connectionId: null, executionHostId: 'runtime:owner-runtime' as const },
      { id: 'twin', connectionId: null, executionHostId: 'runtime:focused-runtime' as const },
      { id: 'twin', connectionId: null, executionHostId: 'runtime:other-runtime' as const }
    ]
  }
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => store.state } }))

import { gitHubRepoImageContext, gitHubBodyImageContext } from './github-image-operation'
import { getGitHubMutationTarget } from './github-work-item-edit-mutations'

const projectOrigin = {
  owner: 'acme',
  repo: 'widgets',
  number: 1,
  type: 'issue' as const,
  projectId: 'p',
  projectItemId: 'i',
  cacheKey: 'github-project:runtime:board-runtime:org/acme/1:view'
}

describe('getGitHubMutationTarget', () => {
  it("routes a tracked repo's edit to the repo owner", () => {
    expect(getGitHubMutationTarget('tracked', projectOrigin)).toEqual({
      kind: 'environment',
      environmentId: 'owner-runtime'
    })
  })

  it('sends an untracked Project row to the host that loaded it, not the focused server', () => {
    expect(getGitHubMutationTarget('untracked', projectOrigin)).toEqual({
      kind: 'environment',
      environmentId: 'board-runtime'
    })
  })

  it('refuses a twin rather than taking the focused copy or this computer', () => {
    expect(() => getGitHubMutationTarget('twin', undefined)).toThrow('No single host owns project')
    expect(getGitHubMutationTarget('twin', projectOrigin)).toEqual({
      kind: 'environment',
      environmentId: 'board-runtime'
    })
  })

  it("uses this computer's credentials for other slug edits with no known repo", () => {
    expect(getGitHubMutationTarget(null, undefined)).toEqual({ kind: 'local' })
  })
})

it('preserves distinct absent-source comment and slug-body policies for twins', () => {
  expect(gitHubRepoImageContext({ repoId: 'twin', repoPath: '/repo' }, 'origin')).toMatchObject({
    runtime: { kind: 'local' },
    target: { kind: 'repo', repo: 'twin', source: 'origin' }
  })
  const args = {
    item: { type: 'pr' as const, repoId: 'twin', url: 'https://github.com/acme/widgets/pull/1' },
    repoPath: '/repo',
    projectOrigin: undefined,
    parsedSlug: { owner: 'acme', repo: 'widgets' }
  }
  expect(() => gitHubBodyImageContext(store.state, args)).toThrow('No single host owns project')
  expect(gitHubBodyImageContext(store.state, { ...args, projectOrigin })).toMatchObject({
    runtime: { kind: 'environment', environmentId: 'board-runtime' },
    target: { kind: 'slug', owner: 'acme', repo: 'widgets' }
  })
})
