// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import * as sourceRuntime from '@/lib/github-source-runtime-context'
import { makeRepo } from '../worktree-jump/worktree-jump-palette-test-fixtures'
import { useGitHubRepoDraftKey } from './use-github-repo-draft-key'

const originalState = useAppStore.getState()
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAppStore.setState(originalState, true)
})

it.each([2, 20])(
  'isolates %i draft owners from unrelated writes and other hosts',
  async (count) => {
    const repos = Array.from({ length: count }, (_, index) => ({
      ...makeRepo(),
      executionHostId: `runtime:host-${index}` as const,
      path: `/host-${index}/repo`
    }))
    useAppStore.setState({ repos })
    const lookup = vi.spyOn(sourceRuntime, 'resolveGitHubRepoOperationOwner')
    const renders = Array<number>(count).fill(0)
    const keys = Array<string>(count)
    const contexts = repos.map((repo, index) => ({
      kind: 'task-source' as const,
      provider: 'github' as const,
      projectId: 'project',
      hostId: `runtime:host-${index}` as const,
      repoId: repo.id
    }))
    function Probe({ index }: { index: number }) {
      keys[index] = useGitHubRepoDraftKey({ repoId: 'repo-1', sourceContext: contexts[index] })
      renders[index]++
      return null
    }
    render(
      <>
        {repos.map((repo, index) => (
          <Probe key={repo.executionHostId} index={index} />
        ))}
      </>
    )
    await act(async () => {})
    lookup.mockClear()
    renders.fill(0)
    for (let index = 0; index < 10; index++) {
      act(() => useAppStore.setState({ rightSidebarOpen: index % 2 === 0 }))
    }
    expect(renders).toEqual(Array<number>(count).fill(0))
    // The selected repos and focused host did not change: no owner lookup is needed for any output.
    expect(lookup).not.toHaveBeenCalled()
    const before = [...keys]
    act(() =>
      useAppStore.setState({
        repos: repos.map((repo, index) =>
          index === 0
            ? { ...repo, ghAccount: { host: 'github.com', user: 'changed-account' } }
            : repo
        )
      })
    )
    expect(renders).toEqual([1, ...Array<number>(count - 1).fill(0)])
    expect(keys[0]).not.toBe(before[0])
    expect(keys.slice(1)).toEqual(before.slice(1))
  }
)
