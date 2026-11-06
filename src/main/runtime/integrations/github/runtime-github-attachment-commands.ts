import { GitHubImageValidationError } from '../../../../shared/github/image-attachment'
import type { Repo } from '../../../../shared/repo-types'
import type { GitHubAttachmentTarget } from '../../../../shared/rpc-contract/github-attachment-params'
import {
  githubAttachmentRepoSelection,
  type GitHubAttachmentRepoSelection
} from '../../../../shared/github/attachment-repo-selection'
import { getRepoRoutingConnectionId } from '../../../../shared/execution-host'
import { ghAccountBindingsEqual } from '../../../../shared/github/account-binding'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'
import type { LocalProjectGhExecOptions } from '../../../workspaces/execution-host/project-runtime-git-options'
import {
  resolveGitHubRepoExecution,
  resolveIssueGitHubApiRepositorySource,
  githubHostExecOptions
} from '../../../github/github-api-repository'
import {
  githubRepoContext,
  ghRepoExecOptions,
  withGitHubRepoExecution
} from '../../../github/github-repository-identity'
import { withGitHubAttachmentExecution } from '../../../github/attachment-publication-execution'
import { uploadGitHubImage } from '../../../github/image-attachment-upload'
import {
  GitHubAttachmentPreparations,
  type GitHubAttachmentCaller
} from '../../../github/attachment-preparation-contexts'
import { projectGhExecOptions } from '../../../github/project-view/internals'
import { runAsDefaultWslCliUserAct } from '../../../git/command-runner/default-wsl-cli-fallback'
import type { GitHubOperationBudget } from '../../../github/github-operation-budget'

export type GitHubAttachmentCommandDeps = {
  resolveRepo: (selector: string) => Promise<Repo>
  getLocalGitArgs: (repo: Repo) => [] | [LocalProjectGhExecOptions]
  resolveHostedReviewTarget: (args: {
    repoSelector: string
    worktreeSelector?: string
  }) => Promise<{ repo: Repo; repoPath: string }>
}
type AttachmentState = {
  selection?: GitHubAttachmentRepoSelection
  repository: GitHubOwnerRepo
  repositoryId?: number
}
const changed = (): Error =>
  new GitHubImageValidationError(
    'The GitHub image destination or account changed. Your draft is kept; try again.'
  )
const repositoryKey = (repo: GitHubOwnerRepo): string =>
  `${repo.host?.toLowerCase() || 'github.com'}/${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`

export class RuntimeGitHubAttachmentCommands {
  private preparations = new GitHubAttachmentPreparations<AttachmentState>()
  constructor(private readonly deps: GitHubAttachmentCommandDeps) {}

  dispose = (): void => this.preparations.dispose()
  retireConnection = (connectionId: string): void =>
    this.preparations.retireConnection(connectionId)

  async selection(selector: string): Promise<GitHubAttachmentRepoSelection> {
    const repo = await this.deps.resolveRepo(selector)
    return githubAttachmentRepoSelection(repo, this.deps.getLocalGitArgs(repo)[0] ?? {})
  }

  private async readTarget(target: GitHubAttachmentTarget) {
    if (target.kind === 'slug') {
      return { repo: undefined, selection: undefined, options: {} }
    }
    const repo = await this.deps.resolveRepo(target.repo)
    const options = this.deps.getLocalGitArgs(repo)[0] ?? {}
    return { repo, selection: githubAttachmentRepoSelection(repo, options), options }
  }

  private targetKey(target: GitHubAttachmentTarget): string {
    return target.kind === 'slug'
      ? `slug:${repositoryKey(target)}`
      : JSON.stringify([
          'repo',
          target.repo,
          target.source,
          target.ownerRepo ? repositoryKey(target.ownerRepo) : null
        ])
  }

  private async resolve(
    target: GitHubAttachmentTarget,
    current: Awaited<ReturnType<RuntimeGitHubAttachmentCommands['readTarget']>>,
    budget: GitHubOperationBudget = {},
    repoPath = current.repo?.path
  ) {
    if (target.kind === 'slug') {
      return { ownerRepo: target, ghOptions: { ...projectGhExecOptions(target.host), ...budget } }
    }
    if (!current.repo || !repoPath) {
      throw changed()
    }
    const options = { ...current.options, ...budget }
    const connectionId = getRepoRoutingConnectionId(current.repo)
    return resolveGitHubRepoExecution(
      repoPath,
      target.ownerRepo ??
        (target.source === 'issue'
          ? async () =>
              (
                await resolveIssueGitHubApiRepositorySource(
                  repoPath,
                  current.repo!.issueSourcePreference,
                  connectionId,
                  options
                )
              ).source
          : undefined),
      connectionId,
      options,
      current.selection?.ghAccount
    )
  }

  async upload(
    args: {
      target: GitHubAttachmentTarget
      preparationId?: string
      fileName: string
      contentType: string
    },
    caller: GitHubAttachmentCaller,
    claim: () => Buffer,
    signal?: AbortSignal
  ): Promise<{ url: string; preparationId: string }> {
    signal?.throwIfAborted()
    const entry = this.preparations.enter(args.preparationId, caller, this.targetKey(args.target))
    const operation = async () => {
      try {
        const result = await uploadGitHubImage({
          ...args,
          signal,
          claim: () => {
            this.preparations.assertActive(entry)
            return claim()
          },
          rememberRepositoryId: (id) => {
            if (entry.value) {
              entry.value.repositoryId = id
            }
          },
          resolve: async (budget) => {
            const current = await this.readTarget(args.target)
            budget.signal?.throwIfAborted()
            this.preparations.assertActive(entry)
            if (entry.value) {
              if (JSON.stringify(current.selection) !== JSON.stringify(entry.value.selection)) {
                throw changed()
              }
              const repository = entry.value.repository
              return {
                ownerRepo: repository,
                repositoryId: entry.value.repositoryId,
                ghOptions:
                  args.target.kind === 'slug'
                    ? { ...projectGhExecOptions(repository.host), ...budget }
                    : {
                        ...ghRepoExecOptions(
                          githubRepoContext(
                            current.repo!.path,
                            getRepoRoutingConnectionId(current.repo!),
                            { ...current.options, ...budget }
                          )
                        ),
                        ...githubHostExecOptions(repository)
                      }
              }
            }
            if (
              args.target.kind === 'repo' &&
              (!args.target.expectedRepoSelection ||
                args.target.expectedGhAccount === undefined ||
                JSON.stringify(current.selection) !==
                  JSON.stringify(args.target.expectedRepoSelection) ||
                !ghAccountBindingsEqual(
                  current.selection?.ghAccount ?? null,
                  args.target.expectedGhAccount
                ))
            ) {
              throw changed()
            }
            const execution = await this.resolve(args.target, current, budget)
            if (!execution.ownerRepo) {
              throw changed()
            }
            entry.value = { selection: current.selection, repository: execution.ownerRepo }
            return execution
          }
        })
        this.preparations.assertActive(entry)
        this.preparations.finish(entry)
        return { ...result, preparationId: entry.id }
      } catch (error) {
        this.preparations.retire(entry)
        throw error
      }
    }
    return args.target.kind === 'slug' && args.target.wakeWslDistro
      ? runAsDefaultWslCliUserAct(operation)
      : operation()
  }

  async publish<T>(
    id: string,
    target: GitHubAttachmentTarget,
    caller: GitHubAttachmentCaller,
    action: () => Promise<T>,
    worktreeSelector?: string
  ): Promise<T> {
    const entry = this.preparations.enter(id, caller, this.targetKey(target))
    this.preparations.retire(entry)
    const current = await this.readTarget(target)
    const state = entry.value
    if (
      !state?.repositoryId ||
      JSON.stringify(current.selection) !== JSON.stringify(state.selection)
    ) {
      throw changed()
    }
    const repoPath =
      target.kind === 'repo' && worktreeSelector
        ? (
            await this.deps.resolveHostedReviewTarget({
              repoSelector: target.repo,
              worktreeSelector
            })
          ).repoPath
        : current.repo?.path
    const execution = await this.resolve(target, current, {}, repoPath)
    if (
      !execution.ownerRepo ||
      repositoryKey(execution.ownerRepo) !== repositoryKey(state.repository)
    ) {
      throw changed()
    }
    // The final check reads authority outside the pinned operation scope, after asynchronous resolution.
    const latest = await this.readTarget(target)
    if (JSON.stringify(latest.selection) !== JSON.stringify(state.selection)) {
      throw changed()
    }
    if (target.kind === 'slug') {
      return target.wakeWslDistro ? runAsDefaultWslCliUserAct(action) : action()
    }
    if (!current.repo || !repoPath) {
      throw changed()
    }
    const connectionId = getRepoRoutingConnectionId(current.repo)
    return withGitHubRepoExecution(
      repoPath,
      connectionId,
      current.options,
      () =>
        withGitHubAttachmentExecution(
          { repoPath, connectionId, wslDistro: current.options.wslDistro ?? null, execution },
          action
        ),
      state.selection?.ghAccount
    )
  }
}
