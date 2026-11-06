import { useGitHubDraft } from '@/components/github/use-github-draft'
import { prepareGitHubImages, gitHubImageContext } from '@/components/github/prepare-github-images'
import type { GitHubDraftPreparation } from '@/components/github/github-work-item-comment-mutations'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import React, { useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { gitHubSlugApiForTarget } from '@/runtime/github-slug-owner-api'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import type { PRComment } from '../../../../../shared/github/comment-types'
import { translate } from '@/i18n/i18n'
import { projectViewErrorMessage } from '../project-view-error-copy'

export function CommentsList({
  owner,
  repo,
  host,
  comments,
  sourceTarget,
  onChange
}: {
  owner: string
  repo: string
  host?: string
  comments: PRComment[]
  sourceTarget: RuntimeClientTarget
  onChange: (next: PRComment[]) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <div className="text-xs italic text-muted-foreground">
          {translate(
            'auto.components.github.project.slug.dialog.Comments.5f104bf855',
            'No comments yet.'
          )}
        </div>
      ) : (
        comments.map((c) => (
          <CommentRow
            key={c.id}
            owner={owner}
            repo={repo}
            host={host}
            comment={c}
            sourceTarget={sourceTarget}
            onDelete={async () => {
              const res = await gitHubSlugApiForTarget(sourceTarget).deleteIssueCommentBySlug({
                owner,
                repo,
                ...(host ? { host } : {}),
                commentId: c.id,
                wakeWslDistro: true
              })
              if (!res.ok) {
                toast.error(projectViewErrorMessage(res.error))
                return
              }
              onChange(comments.filter((x) => x.id !== c.id))
            }}
            onEdit={async (next, preparation) => {
              const imageContext = gitHubImageContext({
                runtime: sourceTarget,
                target: { kind: 'slug', owner, repo, host }
              })
              next = await prepareGitHubImages({
                body: next,
                ...preparation,
                context: imageContext
              })
              if (imageContext.attachmentPreparationId) {
                preparation.signal.throwIfAborted()
              }
              const res = await gitHubSlugApiForTarget(
                imageContext.runtime,
                imageContext.rpcOptions,
                imageContext.attachmentPreparationId
              ).updateIssueCommentBySlug({
                owner,
                repo,
                ...(host ? { host } : {}),
                commentId: c.id,
                body: next,
                wakeWslDistro: true
              })
              if (!res.ok) {
                toast.error(projectViewErrorMessage(res.error))
                return false
              }
              onChange(comments.map((x) => (x.id === c.id ? { ...x, body: next } : x)))

              return true
            }}
          />
        ))
      )}
    </div>
  )
}

function CommentRow({
  owner,
  repo,
  host,
  comment,
  sourceTarget,
  onDelete,
  onEdit
}: {
  owner: string
  repo: string
  host?: string
  comment: PRComment
  sourceTarget: RuntimeClientTarget
  onDelete: () => void | Promise<void>
  onEdit: (next: string, preparation: GitHubDraftPreparation) => Promise<boolean>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const controller = useGitHubDraft(
    draft,
    setDraft,
    JSON.stringify([owner, repo, host, comment.id, editing, sourceTarget])
  )
  return (
    <div className="rounded border border-border/50 bg-muted/20 p-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{comment.author}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              setDraft(comment.body)
              setEditing(true)
            }}
          >
            {translate('auto.components.github.project.slug.dialog.Comments.8564f58542', 'Edit')}
          </button>
          <button type="button" className="hover:underline" onClick={() => void onDelete()}>
            {translate('auto.components.github.project.slug.dialog.Comments.463d030ae4', 'Delete')}
          </button>
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => controller.change(e.target.value)}
            disabled={saving}
            className="min-h-[80px] w-full rounded border border-border/50 bg-background p-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saving}
              onClick={() =>
                void controller.submit(async (body, signal) => {
                  if (
                    await onEdit(body, {
                      signal,
                      beforeUpload: controller.prepareImages,
                      update: controller.prepared
                    })
                  ) {
                    setEditing(false)
                  }
                }, setSaving)
              }
            >
              {translate('auto.components.github.project.slug.dialog.Comments.c3e829b4d9', 'Save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {translate(
                'auto.components.github.project.slug.dialog.Comments.c0e576e96b',
                'Cancel'
              )}
            </Button>
          </div>
        </div>
      ) : (
        <CommentMarkdown content={comment.body} />
      )}
    </div>
  )
}

export function NewCommentForm({
  owner,
  repo,
  host,
  number,
  sourceTarget,
  onAdded
}: {
  owner: string
  repo: string
  host?: string
  number: number
  sourceTarget: RuntimeClientTarget
  onAdded: (c: PRComment) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const controller = useGitHubDraft(
    draft,
    setDraft,
    JSON.stringify([owner, repo, host, number, sourceTarget])
  )
  const canSubmitComment = hasBoundedCommentBodyText(draft)
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => controller.change(e.target.value)}
        disabled={submitting}
        placeholder={translate(
          'auto.components.github.project.slug.dialog.Comments.1c95937c8b',
          'Write a comment…'
        )}
        className="min-h-[80px] w-full rounded border border-border/50 bg-background p-2 text-sm"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!canSubmitComment || submitting}
          onClick={() =>
            void controller.submit(async (currentBody, signal) => {
              const bodyState = getCommentBodySubmitState(currentBody)
              if (bodyState.status === 'empty') {
                return
              }
              if (bodyState.status === 'too-large-leading-whitespace') {
                toast.error(
                  translate(
                    'auto.components.github.project.slug.dialog.Comments.commentTooLarge',
                    'Comment is too large to submit safely.'
                  )
                )
                return
              }
              try {
                const imageContext = gitHubImageContext({
                  runtime: sourceTarget,
                  target: { kind: 'slug', owner, repo, host }
                })
                const body = await prepareGitHubImages({
                  body: bodyState.body,
                  signal,
                  beforeUpload: controller.prepareImages,
                  update: controller.prepared,
                  context: imageContext
                })
                if (imageContext.attachmentPreparationId) {
                  signal.throwIfAborted()
                }
                const res = await gitHubSlugApiForTarget(
                  imageContext.runtime,
                  imageContext.rpcOptions,
                  imageContext.attachmentPreparationId
                ).addIssueCommentBySlug({
                  owner,
                  repo,
                  ...(host ? { host } : {}),
                  number,
                  body,
                  wakeWslDistro: true
                })
                if (!res.ok) {
                  toast.error(projectViewErrorMessage(res.error))
                  return
                }
                onAdded(res.comment)
                setDraft('')
              } finally {
                setSubmitting(false)
              }
            }, setSubmitting)
          }
        >
          <Send className="mr-1 size-3.5" />{' '}
          {translate('auto.components.github.project.slug.dialog.Comments.fd5cccd138', 'Comment')}
        </Button>
      </div>
    </div>
  )
}
