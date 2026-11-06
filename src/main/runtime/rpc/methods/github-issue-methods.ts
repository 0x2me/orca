import { defineGitHubBodyMethod } from './github-body-method'
import { defineMethod } from '../core'
import {
  CreateIssue,
  Issue,
  IssueComment,
  UpdateIssue
} from '../../../../shared/rpc-contract/github-issue-params'

export const GITHUB_ISSUE_METHODS = [
  defineMethod({
    name: 'github.issue',
    permission: 'workspace',
    params: Issue,
    handler: async (params, { runtime }) => runtime.getRepoIssue(params.repo, params.number)
  }),
  defineGitHubBodyMethod({
    name: 'github.createIssue',
    permission: 'workspace',
    params: CreateIssue,
    attachmentTarget: (params) => ({
      target: { kind: 'repo', repo: params.repo, source: 'issue' }
    }),
    handler: async (params, { runtime }) => {
      const fields =
        params.labels !== undefined || params.assignees !== undefined
          ? { labels: params.labels, assignees: params.assignees }
          : undefined
      return fields
        ? runtime.createRepoIssue(params.repo, params.title, params.body, fields)
        : runtime.createRepoIssue(params.repo, params.title, params.body)
    }
  }),
  defineGitHubBodyMethod({
    name: 'github.updateIssue',
    permission: 'workspace',
    params: UpdateIssue,
    attachmentTarget: (params) => ({
      target: { kind: 'repo', repo: params.repo, source: 'issue', ownerRepo: params.ownerRepo }
    }),
    handler: async (params, { runtime }) =>
      runtime.updateRepoIssue(
        params.repo,
        params.number,
        params.updates,
        ...(params.ownerRepo ? ([params.ownerRepo] as const) : ([] as const))
      )
  }),
  defineGitHubBodyMethod({
    name: 'github.addIssueComment',
    permission: 'workspace',
    params: IssueComment,
    attachmentTarget: (params) => ({
      target: {
        kind: 'repo',
        repo: params.repo,
        source: params.type === 'pr' ? 'origin' : 'issue',
        ownerRepo: params.prRepo ?? undefined
      }
    }),
    handler: async (params, { runtime }) =>
      params.type
        ? runtime.addRepoIssueComment(
            params.repo,
            params.number,
            params.body,
            params.prRepo ?? null,
            params.type
          )
        : runtime.addRepoIssueComment(
            params.repo,
            params.number,
            params.body,
            params.prRepo ?? null
          )
  })
]
