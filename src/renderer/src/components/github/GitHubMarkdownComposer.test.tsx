import { GitHubDraft, useGitHubDraft } from './use-github-draft'
import { prepareGitHubImages } from './prepare-github-images'
import type { GitHubImageParseRequest } from '../../../../shared/github/image-parser-protocol'
import { BrowserImageParserFixture } from '../../../../shared/github/__fixtures__/image-parser-worker-fixture'
// @vitest-environment happy-dom

import { Editor } from '@tiptap/react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConversationTab } from '@/components/github-item-dialog/discuss-item/conversation-tab'
import { GHCommentComposer } from '@/components/github-item-dialog/discuss-item/gh-comment-composer'
import type { AppState } from '@/store/types'
import type { GitHubCommentResult, PRComment } from '../../../../shared/github/comment-types'
import { GitHubMarkdownComposer } from './GitHubMarkdownComposer'
import { installOsFileDropCancellationGuard } from '@/lib/os-file-drop-cancellation-guard'

type ComposerStoreState = { settings: Partial<AppState['settings']>; repos: AppState['repos'] }

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: ComposerStoreState) => unknown) => selector({ settings: {}, repos: [] }),
    {
      getState: () => ({ repos: [], recordFeatureInteraction: vi.fn() }),
      subscribe: () => () => {}
    }
  )
}))
vi.mock('@/components/editor/rich-markdown/commands/RichMarkdownToolbar', () => ({
  RichMarkdownToolbar: () => null
}))
vi.mock('@/components/editor/rich-markdown/tables/RichMarkdownTableControls', () => ({
  RichMarkdownTableControls: () => null
}))
vi.mock('@/components/github/github-markdown-composer-preview-pane', () => ({
  GitHubMarkdownComposerPreviewPane: () => null
}))
vi.mock('@/lib/pr-bot-author-overrides', () => ({ usePRBotAuthorOverrides: () => ({}) }))
vi.mock('@/components/github-item-dialog/discuss-item/conversation-tab-activity', () => ({
  ConversationTabActivity: () => null
}))
vi.mock('@/components/github-item-dialog/discuss-item/conversation-tab-pr-sidebar', () => ({
  ConversationTabPRSidebar: () => null
}))
vi.mock('@/components/sidebar/CommentMarkdown', () => ({ default: () => null }))
const { attachmentRpc, finalRpc } = vi.hoisted(() => ({
  attachmentRpc: vi.fn(),
  finalRpc: vi.fn()
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: finalRpc }))
vi.mock('@/runtime/github-attachment-rpc', () => ({ callGitHubAttachmentRpc: attachmentRpc }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const addIssueComment = vi.fn<typeof window.api.gh.addIssueComment>()
const updateIssue = vi.fn<typeof window.api.gh.updateIssue>()
const comment: PRComment = {
  id: 29533,
  author: 'test-author',
  authorAvatarUrl: '',
  body: 'Submitted comment',
  createdAt: '2026-10-23T12:00:00Z',
  url: ''
}

beforeEach(() => {
  vi.stubGlobal('Worker', BrowserImageParserFixture)
  addIssueComment.mockReset()
  updateIssue.mockReset().mockResolvedValue({ ok: true })
  finalRpc.mockReset().mockImplementation(async (_target, method, params) => {
    if (method === 'github.addIssueComment') {
      return addIssueComment(params)
    }
    if (method === 'github.updateIssue') {
      return updateIssue(params)
    }
    throw new Error('Unexpected final writer')
  })
  let staged = ''
  attachmentRpc.mockReset().mockImplementation(async (_target, method, params) => {
    if (method === 'status.get') {
      return { capabilities: ['github.image-attachments.v1'] }
    }
    if (method === 'repo.show') {
      return {
        githubAttachmentSelection: {
          id: 'repo',
          path: '/folder-workspace',
          issueSourcePreference: 'auto',
          connectionId: null,
          executionHostId: null,
          wslDistro: null,
          ghAccount: null
        }
      }
    }
    if (method === 'clipboard.startImageUpload') {
      return { uploadId: 'image' }
    }
    if (method === 'clipboard.appendImageUploadChunk') {
      staged = params.contentBase64
    }
    if (method === 'github.uploadAttachment') {
      return {
        preparationId: 'prepared',
        url: `https://github.com/user-attachments/assets/${staged === 'AA==' ? 'a' : 'b'}`
      }
    }
    return {}
  })
  vi.stubGlobal('api', {
    gh: {
      addIssueComment,
      updateIssue,
      notifyWorkItemMutated: vi.fn().mockResolvedValue(undefined)
    }
  })
})
afterEach(() => {
  cleanup()
  window.dispatchEvent(new Event('pagehide'))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function getComposerEditor(container: HTMLElement): HTMLElement {
  const editor = container.querySelector<HTMLElement>('.tiptap')
  if (!editor) {
    throw new Error('Composer editor did not mount')
  }
  return editor
}

function dropImageFiles(element: HTMLElement, transfer: DataTransfer): void {
  Object.defineProperty(transfer, 'types', { value: ['Files'] })
  const event = new Event('drop', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    isTrusted: { value: true },
    clientX: { value: 10 },
    clientY: { value: 10 }
  })
  act(() => {
    element.dispatchEvent(event)
  })
}

async function enterComment(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.querySelector('.tiptap')).not.toBeNull())
  fireEvent.input(getComposerEditor(container), {
    target: { innerHTML: '<p>Submitted comment</p>' }
  })
}

function renderCommentSubmission() {
  const onCommentAdded = vi.fn()
  const view = render(
    <TooltipProvider>
      <GHCommentComposer
        repoPath="/folder-workspace"
        issueNumber={29521}
        itemType="issue"
        onCommentAdded={onCommentAdded}
      />
    </TooltipProvider>
  )
  return { ...view, onCommentAdded }
}

describe('GitHubMarkdownComposer submission', () => {
  it.each([
    { trigger: 'button', count: 2, intake: 'paste' },
    { trigger: 'shortcut', count: 20, intake: 'paste' },
    { trigger: 'button', count: 2, intake: 'drop' }
  ])(
    'includes $count delayed $intake files before $trigger submission without rebuilding the editor',
    async ({ trigger, count, intake }) => {
      const readers: FileReader[] = []
      vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
        this: FileReader
      ) {
        readers.push(this)
      })
      const request = Promise.withResolvers<GitHubCommentResult>()
      addIssueComment.mockReturnValue(request.promise)
      const view = renderCommentSubmission()
      await enterComment(view.container)
      const element = getComposerEditor(view.container)
      if (!('editor' in element) || !(element.editor instanceof Editor)) {
        throw new Error('Missing real editor')
      }
      const editor = element.editor
      if (!editor.markdown) {
        throw new Error('Missing Markdown extension')
      }
      const parse = vi.spyOn(editor.markdown, 'parse')
      act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1))
      const clipboardData = new DataTransfer()
      for (let index = 0; index < count; index++) {
        clipboardData.items.add(
          new File([String(index)], `screen-${index}.png`, { type: 'image/png' })
        )
      }
      if (intake === 'drop') {
        onTestFinished(installOsFileDropCancellationGuard())
        vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
          pos: editor.state.doc.content.size - 1,
          inside: -1
        })
        dropImageFiles(element, clipboardData)
      } else {
        fireEvent.paste(element, { clipboardData })
      }
      act(() => editor.view.dispatch(editor.state.tr.insertText('prefix ', 1)))
      if (trigger === 'button') {
        fireEvent.click(view.getByRole('button', { name: 'Send comment' }))
      } else {
        fireEvent.keyDown(element, { key: 'Enter', ctrlKey: true })
      }
      expect(addIssueComment).not.toHaveBeenCalled()
      expect(element.getAttribute('contenteditable')).toBe('true')
      await act(async () => {
        for (let index = 1; index < count; index++) {
          Object.defineProperty(readers[index], 'result', {
            value: `data:image/png;base64,${Buffer.from([index]).toString('base64')}`
          })
          readers[index].dispatchEvent(new ProgressEvent('load'))
        }
      })
      expect(addIssueComment).not.toHaveBeenCalled()
      await act(async () => {
        Object.defineProperty(readers[0], 'result', { value: 'data:image/png;base64,AA==' })
        readers[0].dispatchEvent(new ProgressEvent('load'))
      })
      await waitFor(() => expect(addIssueComment).toHaveBeenCalledOnce())
      expect(finalRpc).toHaveBeenCalledWith(
        { kind: 'local' },
        'github.addIssueComment',
        expect.objectContaining({ attachmentPreparationId: 'prepared' }),
        expect.objectContaining({ timeoutMs: 30_000 })
      )
      const posted = addIssueComment.mock.calls[0][0].body
      expect(posted).toBe(
        `prefix Submitted comment![](https://github.com/user-attachments/assets/a)${'![](https://github.com/user-attachments/assets/b)'.repeat(count - 1)}`
      )
      expect(posted).not.toContain('data:')
      expect(parse).not.toHaveBeenCalled()
      await act(async () => request.resolve({ ok: true, comment }))
    }
  )

  it('clears the real submission owner and editor after a successful request', async () => {
    const request = Promise.withResolvers<GitHubCommentResult>()
    addIssueComment.mockReturnValue(request.promise)
    const view = renderCommentSubmission()
    const send = view.getByRole('button', { name: 'Send comment' })
    await enterComment(view.container)
    await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false))
    fireEvent.click(send)
    await waitFor(() =>
      expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('false')
    )
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(addIssueComment).toHaveBeenCalledOnce()
    expect(addIssueComment.mock.calls[0]?.[0].body).toBe('Submitted comment')

    await act(async () => request.resolve({ ok: true, comment }))

    await waitFor(() => {
      expect(getComposerEditor(view.container).textContent).toBe('')
      expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('true')
      expect(send.hasAttribute('disabled')).toBe(true)
    })
    expect(view.onCommentAdded).toHaveBeenCalledExactlyOnceWith(comment)
  })

  it.each(['result-error', 'rejection'])(
    'preserves a failed draft for retry (%s)',
    async (kind) => {
      const request = Promise.withResolvers<GitHubCommentResult>()
      addIssueComment.mockReturnValueOnce(request.promise)
      const view = renderCommentSubmission()
      const send = view.getByRole('button', { name: 'Send comment' })
      await enterComment(view.container)
      await waitFor(() => expect(send.hasAttribute('disabled')).toBe(false))
      fireEvent.click(send)
      await waitFor(() =>
        expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('false')
      )

      await act(async () => {
        if (kind === 'rejection') {
          request.reject(new Error('Request failed'))
        } else {
          request.resolve({ ok: false, error: 'Request failed' })
        }
      })

      await waitFor(() => {
        expect(getComposerEditor(view.container).textContent).toBe('Submitted comment')
        expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('true')
        expect(send.hasAttribute('disabled')).toBe(false)
      })
      expect(view.onCommentAdded).not.toHaveBeenCalled()
      const retry = Promise.withResolvers<GitHubCommentResult>()
      addIssueComment.mockReturnValueOnce(retry.promise)
      fireEvent.click(send)
      await waitFor(() =>
        expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('false')
      )
      await act(async () => retry.resolve({ ok: true, comment }))
      await waitFor(() => {
        expect(getComposerEditor(view.container).textContent).toBe('')
        expect(send.hasAttribute('disabled')).toBe(true)
      })
      expect(view.onCommentAdded).toHaveBeenCalledExactlyOnceWith(comment)
    }
  )

  it('does not report editability changes as draft edits', async () => {
    const onChange = vi.fn()
    const props = { value: 'Draft comment', onChange, placeholder: 'Add a comment…' }
    const view = render(<GitHubMarkdownComposer {...props} />)
    await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
    onChange.mockClear()

    view.rerender(<GitHubMarkdownComposer {...props} disabled />)
    view.rerender(<GitHubMarkdownComposer {...props} disabled={false} />)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts an external nonempty value while editability changes', async () => {
    const onChange = vi.fn()
    const props = { value: 'Original description', onChange, placeholder: 'Description' }
    const view = render(<GitHubMarkdownComposer {...props} />)
    await waitFor(() => expect(getComposerEditor(view.container).textContent).toBe(props.value))
    onChange.mockClear()

    view.rerender(<GitHubMarkdownComposer {...props} value="Updated description" disabled />)
    await waitFor(() =>
      expect(getComposerEditor(view.container).textContent).toBe('Updated description')
    )
    view.rerender(
      <GitHubMarkdownComposer {...props} value="Updated description" disabled={false} />
    )

    expect(getComposerEditor(view.container).getAttribute('contenteditable')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(['button', 'shortcut'])(
    'saves the real description owner after an accepted delayed paste via %s',
    async (trigger) => {
      const readers: FileReader[] = []
      vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
        this: FileReader
      ) {
        readers.push(this)
      })
      const onBodyUpdated = vi.fn()
      const view = render(
        <TooltipProvider>
          <ConversationTab
            item={{
              id: 'issue-1',
              type: 'issue',
              number: 29521,
              title: 'Issue',
              state: 'open',
              url: 'https://github.com/owner/repo/issues/29521',
              labels: [],
              updatedAt: '2026-11-05T12:00:00Z',
              author: 'author',
              repoId: 'repo'
            }}
            repoPath="/folder-workspace"
            repoId="repo"
            body="Original description"
            comments={[]}
            files={[]}
            headSha={undefined}
            baseSha={undefined}
            loading={false}
            detailsLoaded={true}
            checks={undefined}
            localState="open"
            projectOrigin={undefined}
            onStateChange={vi.fn()}
            onMutated={vi.fn()}
            onChecksUpdated={vi.fn()}
            onBodyUpdated={onBodyUpdated}
            onCommentAdded={vi.fn()}
            onReviewersRequested={vi.fn()}
          />
        </TooltipProvider>
      )
      fireEvent.click(view.getByRole('button', { name: 'Edit description' }))
      await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
      const element = getComposerEditor(view.container)
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File(['a'], 'screenshot.png', { type: 'image/png' }))
      fireEvent.paste(element, { clipboardData })
      if (trigger === 'button') {
        const save = view.getByRole('button', { name: 'Save' })
        expect(save.hasAttribute('disabled')).toBe(false)
        fireEvent.click(save)
      } else {
        fireEvent.keyDown(element, { key: 'Enter', ctrlKey: true })
      }
      expect(updateIssue).not.toHaveBeenCalled()
      await act(async () => {
        const reader = readers[0]
        if (!reader) {
          throw new Error('Missing accepted image read')
        }
        Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,AA==' })
        reader.dispatchEvent(new ProgressEvent('load'))
      })
      await waitFor(() => expect(updateIssue).toHaveBeenCalledOnce())
      expect(updateIssue.mock.calls[0][0].updates.body).toContain(
        'https://github.com/user-attachments/assets/a'
      )
      expect(onBodyUpdated).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/user-attachments/assets/a')
      )
    }
  )
})

it('pre-indexes raw HTML once before uploading and immediately retains an uploaded URL when the next upload fails', async () => {
  const jobs: string[] = []
  class TrackedParser extends BrowserImageParserFixture {
    postMessage(request: GitHubImageParseRequest) {
      jobs.push(request.kind)
      super.postMessage(request)
    }
  }
  vi.stubGlobal('Worker', TrackedParser)
  const original =
    '<div>\n<img src="data:image/png;base64,AA=="><img src="data:image/png;base64,AQ==">\n</div>'
  const changed = vi.fn()
  const draft = new GitHubDraft(original, changed, 'owner')
  const view = render(
    <GitHubMarkdownComposer
      value={original}
      draft={draft}
      onChange={draft.change}
      placeholder="Description"
    />
  )
  await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
  const element = getComposerEditor(view.container)
  if (!('editor' in element) || !(element.editor instanceof Editor) || !element.editor.markdown) {
    throw new Error('Missing editor')
  }
  const editor = element.editor
  const parse = vi.spyOn(element.editor.markdown, 'parse')
  const rpc = attachmentRpc.getMockImplementation()!
  let uploads = 0
  attachmentRpc.mockImplementation(async (...args) => {
    if (args[1] === 'github.uploadAttachment') {
      uploads++
      expect(jobs).toEqual(['prepare', 'html'])
      if (uploads === 2) {
        throw new Error('Upload failed. Your draft is kept; try again.')
      }
    }
    return rpc(...args)
  })
  await act(async () => {
    await draft.submit(
      async (body, signal) => {
        await prepareGitHubImages({
          body,
          signal,
          context: {
            runtime: { kind: 'local' },
            target: { kind: 'slug', owner: 'owner', repo: 'repo', host: 'github.com' }
          },
          update: draft.prepared,
          beforeUpload: draft.prepareImages
        })
      },
      () => {}
    )
  })
  const expected =
    '<div>\n<img src="https://github.com/user-attachments/assets/a"><img src="data:image/png;base64,AQ==">\n</div>'
  expect(draft.value).toBe(expected)
  expect(editor.getMarkdown()).toBe(
    '<div>\n\n<img src="https://github.com/user-attachments/assets/a"><img src="data:image/png;base64,AQ==">\n\n</div>'
  )
  expect(changed).toHaveBeenCalledExactlyOnceWith(expected)
  expect(parse).not.toHaveBeenCalled()
  expect(jobs).toEqual(['prepare', 'html'])
})

it('fails before uploading when raw HTML replacement ranges are unavailable', async () => {
  class UnsafeIndexParser extends BrowserImageParserFixture {
    postMessage(request: GitHubImageParseRequest) {
      if (request.kind !== 'html') {
        super.postMessage(request)
        return
      }
      queueMicrotask(() =>
        this.onmessage?.(
          new MessageEvent('message', {
            data: {
              id: request.id,
              ok: true,
              result: {
                kind: 'html',
                images: [[{ source: 'data:image/png;base64,AA==', start: -1, end: -1 }]]
              }
            }
          })
        )
      )
    }
  }
  vi.stubGlobal('Worker', UnsafeIndexParser)
  const original = '<div>\n<img src="data:image/png;base64,AA==">\n</div>'
  const draft = new GitHubDraft(original, vi.fn(), 'owner')
  const view = render(
    <GitHubMarkdownComposer
      value={original}
      draft={draft}
      onChange={draft.change}
      placeholder="Description"
    />
  )
  await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
  attachmentRpc.mockClear()
  await act(async () => {
    await draft.submit(
      async (body, signal) => {
        await prepareGitHubImages({
          body,
          signal,
          context: {
            runtime: { kind: 'local' },
            target: { kind: 'slug', owner: 'owner', repo: 'repo', host: 'github.com' }
          },
          update: draft.prepared,
          beforeUpload: draft.prepareImages
        })
      },
      () => {}
    )
  })
  expect(attachmentRpc).not.toHaveBeenCalled()
  expect(draft.value).toBe(original)
})

it('prepares a reference-definition image through its actual rich editor owner', async () => {
  const original = '![shot][capture]\n\n[capture]: data:image/png;base64,AA=='
  const draft = new GitHubDraft(original, vi.fn(), 'owner')
  const view = render(
    <GitHubMarkdownComposer
      value={original}
      draft={draft}
      onChange={draft.change}
      placeholder="Description"
    />
  )
  await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
  await act(async () => {
    await draft.submit(
      async (body, signal) => {
        await prepareGitHubImages({
          body,
          signal,
          context: {
            runtime: { kind: 'local' },
            target: { kind: 'slug', owner: 'owner', repo: 'repo', host: 'github.com' }
          },
          update: draft.prepared,
          beforeUpload: draft.prepareImages
        })
      },
      () => {}
    )
  })
  expect(
    attachmentRpc.mock.calls.filter((call) => call[1] === 'github.uploadAttachment')
  ).toHaveLength(1)
  expect(draft.value).toBe(
    '![shot][capture]\n\n[capture]: https://github.com/user-attachments/assets/a'
  )
})

it('replaces an unresolved raw HTML image while preserving an unrelated valueless src', async () => {
  const original = '<div>\n<img src><img src="data:image/png;base64,YQ==">\n</div>'
  const draft = new GitHubDraft(original, vi.fn(), 'owner')
  const view = render(
    <GitHubMarkdownComposer
      value={original}
      draft={draft}
      onChange={draft.change}
      placeholder="Description"
    />
  )
  await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
  const element = getComposerEditor(view.container)
  if (!('editor' in element) || !(element.editor instanceof Editor)) {
    throw new Error('Missing real editor')
  }
  const editor = element.editor
  await act(async () => {
    await draft.submit(
      async (body, signal) => {
        await prepareGitHubImages({
          body,
          signal,
          context: {
            runtime: { kind: 'local' },
            target: { kind: 'slug', owner: 'owner', repo: 'repo', host: 'github.com' }
          },
          update: draft.prepared,
          beforeUpload: draft.prepareImages
        })
      },
      () => {}
    )
  })
  expect(
    attachmentRpc.mock.calls.filter((call) => call[1] === 'github.uploadAttachment')
  ).toHaveLength(1)
  expect(draft.value).toBe(
    '<div>\n<img src><img src="https://github.com/user-attachments/assets/b">\n</div>'
  )
  expect(editor.getMarkdown()).toBe(
    '<div>\n\n<img src><img src="https://github.com/user-attachments/assets/b">\n\n</div>'
  )
})

it('delivers a dropped image through the app file guard without losing surrounding text', async () => {
  const original = 'Before. After.'
  const draft = new GitHubDraft(original, vi.fn(), 'owner')
  const view = render(
    <GitHubMarkdownComposer value={original} draft={draft} onChange={draft.change} />
  )
  await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
  const element = getComposerEditor(view.container)
  if (!('editor' in element) || !(element.editor instanceof Editor)) {
    throw new Error('Missing real editor')
  }
  const editor = element.editor
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 9, inside: -1 })
  act(() => {
    editor.commands.setTextSelection({ from: 1, to: 8 })
  })
  const disposeGuard = installOsFileDropCancellationGuard()
  try {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array([0, 128, 255])], 'screen.png', { type: 'image/png' })
    )
    dropImageFiles(element, transfer)
    await waitFor(() =>
      expect(element.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AID/')
    )
    expect(draft.value).toMatch(
      /Before\.[\s]*!\[[^\]]*\]\(data:image\/png;base64,AID\/\)[\s]*After\./
    )
  } finally {
    disposeGuard()
  }
})

it.each(['unmount', 'reset', 'editor replacement'])(
  'keeps a held drop owned during %s without late publication or successor insertion',
  async (change) => {
    const readers: FileReader[] = []
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      readers.push(this)
    })
    const abort = vi.spyOn(FileReader.prototype, 'abort')
    const publish = vi.fn(async () => {})
    const update = vi.fn()
    let submission: Promise<void> | undefined
    let acceptedSignal: AbortSignal | undefined
    function Owner({ ownerKey = 'owner', editorKey = 'editor' }) {
      const draft = useGitHubDraft('Original text.', update, ownerKey)
      return (
        <>
          <GitHubMarkdownComposer
            key={editorKey}
            value="Original text."
            draft={draft}
            onChange={draft.change}
          />
          <button
            onClick={() => {
              acceptedSignal = draft.signal
              submission = draft.submit(publish, () => {})
            }}
          >
            Submit draft
          </button>
        </>
      )
    }
    const view = render(<Owner />)
    await waitFor(() => expect(view.container.querySelector('.tiptap')).not.toBeNull())
    const element = getComposerEditor(view.container)
    if (!('editor' in element) || !(element.editor instanceof Editor)) {
      throw new Error('Missing real editor')
    }
    vi.spyOn(element.editor.view, 'posAtCoords').mockReturnValue({ pos: 5, inside: -1 })
    onTestFinished(installOsFileDropCancellationGuard())
    const transfer = new DataTransfer()
    transfer.items.add(new File(['image'], 'screen.png', { type: 'image/png' }))
    dropImageFiles(element, transfer)
    expect(readers).toHaveLength(1)
    fireEvent.click(view.getByRole('button', { name: 'Submit draft' }))
    expect(publish).not.toHaveBeenCalled()
    if (change === 'unmount') {
      view.unmount()
    } else if (change === 'reset') {
      view.rerender(<Owner ownerKey="replacement" />)
    } else {
      view.rerender(<Owner editorKey="replacement" />)
    }
    if (change === 'editor replacement') {
      expect(abort).not.toHaveBeenCalled()
      expect(acceptedSignal?.aborted).toBe(false)
    } else {
      expect(abort).toHaveBeenCalledOnce()
      expect(acceptedSignal?.aborted).toBe(true)
    }
    await act(async () => {
      Object.defineProperty(readers[0], 'result', { value: 'data:image/png;base64,AA==' })
      readers[0].dispatchEvent(new ProgressEvent('load'))
      await submission
    })
    expect(update).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(view.container.querySelector('img')).toBeNull()
    if (change === 'editor replacement') {
      fireEvent.click(view.getByRole('button', { name: 'Submit draft' }))
      await act(async () => {
        await submission
      })
      expect(publish).toHaveBeenCalledExactlyOnceWith('Original text.', expect.any(AbortSignal))
    }
  }
)
