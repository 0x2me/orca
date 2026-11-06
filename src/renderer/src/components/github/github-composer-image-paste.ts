import type { RefObject } from 'react'
import { useOsFileDropOwner } from '@/hooks/use-os-file-drop-owner'
import type { Editor, EditorOptions } from '@tiptap/react'
import type { GitHubDraft } from './use-github-draft'
import { assertGitHubImage } from '../../../../shared/github/image-attachment'
import { captureRichMarkdownImageInsertionTarget } from '@/components/editor/rich-markdown/images/rich-markdown-image-insertion-target'
import { buildRichMarkdownImageInsertContent } from '@/components/editor/rich-markdown/images/rich-markdown-image-insert-content'
import { richMarkdownClipboardInsertionOrderKey } from '@/components/editor/rich-markdown/clipboard/rich-markdown-clipboard-insertion-order'

export function pasteGitHubImages(editor: Editor, files: File[], draft: GitHubDraft): boolean {
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (!images.length || !editor.isEditable) {
    return false
  }
  for (const file of images) {
    const target = captureRichMarkdownImageInsertionTarget(editor)
    if (!target) {
      continue
    }
    draft.read(async (signal) => {
      try {
        assertGitHubImage(file.type, file.size)
        signal.throwIfAborted()
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          const fail = (): void => {
            signal.removeEventListener('abort', abort)
            reject(new Error('The image could not be read. Paste it again.'))
          }
          const abort = (): void => {
            reader.abort()
            fail()
          }
          reader.onerror = fail
          reader.onabort = fail
          reader.onload = () => {
            signal.removeEventListener('abort', abort)
            if (typeof reader.result === 'string') {
              resolve(reader.result)
            } else {
              fail()
            }
          }
          signal.addEventListener('abort', abort, { once: true })
          reader.readAsDataURL(file)
        })
        signal.throwIfAborted()
        const range = target.getRange()
        if (!range) {
          throw new Error('The image insertion point changed. Paste the image again.')
        }
        const cellSelection = range.cellSelection
        const chain = cellSelection
          ? editor.chain().command(({ tr }) => {
              const selection = tr.selection
              cellSelection.replaceWith(
                tr,
                editor.schema.nodes.image.create({ src, alt: file.name })
              )
              tr.setSelection(selection.map(tr.doc, tr.mapping))
              return true
            })
          : editor
              .chain()
              .insertContentAt(
                range.from === range.to ? range.from : range,
                buildRichMarkdownImageInsertContent(editor, range.from, { src }),
                { updateSelection: false }
              )
        const inserted = chain
          .setMeta(richMarkdownClipboardInsertionOrderKey, range.requestOrder)
          .run()
        if (!inserted) {
          throw new Error('The image could not be inserted. Paste it again.')
        }
      } finally {
        target.dispose()
      }
    })
  }
  return true
}

export function gitHubComposerImageHandlers(
  editorRef: RefObject<Editor | null>,
  draftRef: RefObject<GitHubDraft | undefined>
): Pick<NonNullable<EditorOptions['editorProps']>, 'handlePaste'> {
  return {
    handlePaste: (_view, event) => {
      const current = editorRef.current
      return (
        !!current &&
        !!draftRef.current &&
        pasteGitHubImages(current, Array.from(event.clipboardData?.files ?? []), draftRef.current)
      )
    }
  }
}

export function useGitHubComposerImageDrop(
  rootRef: RefObject<HTMLElement | null>,
  editorRef: RefObject<Editor | null>,
  draftRef: RefObject<GitHubDraft | undefined>,
  enabled: boolean
): (root: HTMLElement | null) => void {
  return useOsFileDropOwner(rootRef, {
    kind: 'files',
    canAccept: (event) => {
      const current = editorRef.current
      return !!(
        enabled &&
        current?.isEditable &&
        !current.isDestroyed &&
        draftRef.current &&
        event.target instanceof Node &&
        current.view.dom.contains(event.target)
      )
    },
    captureDestination: (event) => {
      const editor = editorRef.current
      const draft = draftRef.current
      if (!editor || !draft) {
        return null
      }
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      return position ? { editor, draft, position: position.pos } : null
    },
    onFiles: (files, { destination }) => {
      if (!destination || !destination.editor.commands.setTextSelection(destination.position)) {
        return
      }
      pasteGitHubImages(destination.editor, files, destination.draft)
    }
  })
}
