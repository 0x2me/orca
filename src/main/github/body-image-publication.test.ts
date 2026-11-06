import type * as NodeFs from 'node:fs'
import { NodeImageParserFixture } from '../../shared/github/__fixtures__/image-parser-worker-fixture'
import { beforeEach, expect, it, vi } from 'vitest'
import type * as GhUtils from './gh-utils'
import { createIssue } from './issue-create'
import { updateIssue } from './issue-update'
import { addIssueComment } from './issue-comment'
import { updatePRDetails } from './client/update/pr-details'
import { addPRReviewComment, addPRReviewCommentReply } from './client/create/add-pr-review-comment'
import { createGitHubPullRequest } from './client/create/create-github-pull-request'
import { updateIssueBySlug } from './project-view/mutations'
import { updatePullRequestBySlug } from './project-view/pull-request-mutation'
import {
  addIssueCommentBySlug,
  updateIssueCommentBySlug
} from './project-view/issue-comment-mutations'

vi.mock('../worker-threads/worker-thread-spawn', () => ({
  spawnWorkerThread: () => new NodeImageParserFixture()
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof NodeFs>()
  return {
    ...fs,
    existsSync: (path: string) =>
      path.endsWith('image-parser-worker-entry.js') || fs.existsSync(path)
  }
})
const effects = vi.hoisted(() => ({ gh: vi.fn(), rest: vi.fn() }))
vi.mock('./gh-utils', async (original) => ({
  ...(await original<typeof GhUtils>()),
  ghExecFileAsync: effects.gh
}))
vi.mock('./github-api-repository', () => ({
  resolveGitHubRepoExecution: async () => ({
    ownerRepo: { owner: 'owner', repo: 'repo', host: 'github.com' },
    ghOptions: {}
  }),
  getOriginGitHubApiRepository: async () => ({ owner: 'owner', repo: 'repo', host: 'github.com' }),
  githubHostExecOptions: () => ({ host: 'github.com' })
}))
vi.mock('./project-view/internals', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runRest: effects.rest,
  ghExecFileAsync: effects.gh
}))

beforeEach(() => {
  effects.gh.mockReset()
  effects.rest.mockReset()
})
const body = '![before `[` after](data:image/png;base64,YQ==)'
const slug = { owner: 'owner', repo: 'repo', host: 'github.com', number: 42 }
const writers = [
  () => createIssue('/repo', 'Screenshot', body),
  () => updateIssue('/repo', 42, { body, title: 'Changed', state: 'closed' }),
  () => addIssueComment('/repo', 42, body),
  () => updatePRDetails('/repo', 42, { body, title: 'Changed' }),
  () =>
    addPRReviewComment({
      repoPath: '/repo',
      prNumber: 42,
      commitId: 'abc',
      path: 'file.ts',
      line: 1,
      body
    }),
  () => addPRReviewCommentReply('/repo', 42, 1, body),
  () =>
    createGitHubPullRequest(
      '/repo',
      { provider: 'github', title: 'Screenshot', base: 'main', head: 'feature', body },
      'local'
    ),
  () => updateIssueBySlug({ ...slug, updates: { body, title: 'Changed', state: 'closed' } }),
  () => updatePullRequestBySlug({ ...slug, updates: { body, title: 'Changed', state: 'closed' } }),
  () => addIssueCommentBySlug({ ...slug, body }),
  () => updateIssueCommentBySlug({ ...slug, commentId: 1, body })
]

it.each(writers.map((write, index) => ({ write, index })))(
  'refuses an unresolved image before any public effect in writer $index',
  async ({ write }) => {
    const result = await write()
    expect(JSON.stringify(result)).toContain('not been uploaded')
    expect(result).toMatchObject({ ok: false })
    expect(effects.gh).not.toHaveBeenCalled()
    expect(effects.rest).not.toHaveBeenCalled()
  }
)
