import type { GitHubDraft } from './use-github-draft'
import type { GitHubOwnerRepo } from '../../../../shared/github/pull-request-types'

export type GitHubMarkdownComposerProps = {
  draft?: GitHubDraft
  value: string
  onChange: (value: string) => void
  placeholder: string
  minHeightClassName?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  onSubmitShortcut?: () => void
  layout?: 'stacked' | 'tabbed'
  previewGithubRepo?: GitHubOwnerRepo | null
}
