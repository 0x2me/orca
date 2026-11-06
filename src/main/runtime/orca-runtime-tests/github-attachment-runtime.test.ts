import { expect, it } from 'vitest'
import './runtime-test-module-registration.spec'
import { OrcaRuntimeService } from '../orca-runtime'
import { createHostedReviewMock, setPlatform } from '../orca-runtime-test-mocks/setup.spec'
import { TEST_REPO_ID, TEST_REPO_PATH, store } from './orca-runtime-test-fixtures.spec'
import { withGitHubAttachmentExecution } from '../../github/attachment-publication-execution'
import { _setWslCachesForTests, _resetWslCachesForTests } from '../../wsl/discovery/distro-catalog'

it.each(['wsl', 'windows-host'] as const)(
  'projects the owning Windows runtime selection for a paired client with %s Git',
  async (git) => {
    setPlatform('win32')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the existing runtime fixture provides every store method used by this projection.
    const runtime = new OrcaRuntimeService({
      ...store,
      getProjects: () => [
        {
          id: 'project',
          displayName: 'Project',
          badgeColor: '',
          sourceRepoIds: [TEST_REPO_ID],
          localWindowsRuntimePreference: {
            kind: 'wsl',
            distro: 'Ubuntu',
            ...(git === 'windows-host' ? { git } : {})
          },
          createdAt: 0,
          updatedAt: 0
        }
      ],
      getSettings: () => ({
        ...store.getSettings(),
        localWindowsRuntimeDefault: { kind: 'windows-host' }
      })
    } as never)
    expect(await runtime.getGitHubAttachmentSelection(`id:${TEST_REPO_ID}`)).toMatchObject({
      id: TEST_REPO_ID,
      path: TEST_REPO_PATH,
      wslDistro: git === 'wsl' ? 'Ubuntu' : null,
      ghAccount: null
    })
    _setWslCachesForTests({ available: true, distros: ['Debian'] })
    try {
      await expect(runtime.getGitHubAttachmentSelection(`id:${TEST_REPO_ID}`)).rejects.toThrow(
        'requires repair'
      )
    } finally {
      _resetWslCachesForTests()
    }
  }
)

it.each([null, 'ssh-1'])(
  'preserves local shared-link exclusions and SSH isolation for an image-bearing hosted creation (%s)',
  async (connectionId) => {
    const repo = { ...store.getRepos()[0], symlinkPaths: ['shared-cache'], connectionId }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the existing runtime fixture provides every store method used by this projection.
    const runtime = new OrcaRuntimeService({
      ...store,
      getRepos: () => [repo],
      getRepo: () => repo
    } as never)
    createHostedReviewMock.mockResolvedValueOnce({
      ok: true,
      number: 42,
      url: 'https://github.com/owner/repo/pull/42'
    })
    const input = {
      repoSelector: `id:${TEST_REPO_ID}`,
      provider: 'github' as const,
      title: 'Image',
      base: 'main',
      head: 'feature',
      body: '![image](https://github.com/user-attachments/assets/image)'
    }
    await withGitHubAttachmentExecution(
      {
        repoPath: TEST_REPO_PATH,
        connectionId,
        wslDistro: null,
        execution: {
          ownerRepo: { owner: 'owner', repo: 'repo', host: 'github.com' },
          ghOptions: {}
        }
      },
      () => runtime.createHostedReview(input)
    )
    expect(createHostedReviewMock).toHaveBeenCalledWith(
      TEST_REPO_PATH,
      expect.objectContaining({ body: input.body }),
      connectionId ? 'ssh:ssh-1' : 'local',
      {
        localGitExecOptions: { admissionTier: 'interactive' },
        ...(connectionId ? {} : { sharedLinkPaths: ['shared-cache'] })
      }
    )
  }
)
