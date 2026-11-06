import { useEffect, type RefObject } from 'react'
import type { GitHubDraft } from './use-github-draft'
import type { Editor } from '@tiptap/react'
import type { GitHubPreparedImage } from './use-github-draft'
import { htmlImageDestinations } from '../../../../shared/github/html-image-destinations'
import { replaceMarkdownImageDestinations } from '../../../../shared/github/markdown-image-destinations'

/** A submit changes attributes only, so indexed ProseMirror positions remain stable. */
export function createGitHubPreparedImageUpdater(editor: Editor) {
  let attempt: object | undefined
  const positions = new Map<string, Set<number>>()
  const rawNodes = new Map<
    number,
    {
      value: string
      destinations: ReturnType<typeof htmlImageDestinations>['images']
      urls: Map<string, string>
    }
  >()
  return (image: GitHubPreparedImage): boolean => {
    if (attempt !== image.attempt) {
      attempt = image.attempt
      positions.clear()
      rawNodes.clear()
      editor.state.doc.descendants((node, position) => {
        const add = (source: string): void => {
          let entries = positions.get(source)
          if (!entries) {
            positions.set(source, (entries = new Set()))
          }
          entries.add(position)
        }
        if (node.type.name === 'image' && typeof node.attrs.src === 'string') {
          add(node.attrs.src)
        }
        if (
          (node.type.name === 'rawMarkdownHtmlInline' ||
            node.type.name === 'rawMarkdownHtmlBlock') &&
          typeof node.attrs.value === 'string'
        ) {
          const destinations = htmlImageDestinations(node.attrs.value, 0).images
          rawNodes.set(position, { value: node.attrs.value, destinations, urls: new Map() })
          destinations.forEach((destination) => add(destination.source))
        }
      })
    }
    const matches = positions.get(image.source)
    if (!matches?.size) {
      return false
    }
    const transaction = editor.state.tr
    for (const position of matches) {
      const node = transaction.doc.nodeAt(position)
      if (!node) {
        return false
      }
      const raw = rawNodes.get(position)
      if (raw) {
        raw.urls.set(image.source, image.url)
        transaction.setNodeMarkup(position, undefined, {
          ...node.attrs,
          value: replaceMarkdownImageDestinations(raw.value, raw.destinations, raw.urls)
        })
      } else {
        transaction.setNodeMarkup(position, undefined, { ...node.attrs, src: image.url })
      }
    }
    editor.view.dispatch(transaction)
    return true
  }
}

export function useGitHubPreparedImageUpdates(
  editor: Editor | null,
  draft: GitHubDraft | undefined,
  applying: RefObject<boolean>,
  lastSynced: RefObject<string>
): void {
  useEffect(() => {
    if (!editor || !draft) {
      return
    }
    const replaceImage = createGitHubPreparedImageUpdater(editor)
    return draft.subscribeImageReplacement((image) => {
      if (editor.isDestroyed) {
        return
      }
      applying.current = true
      try {
        if (replaceImage(image)) {
          lastSynced.current = image.body
        }
      } finally {
        applying.current = false
      }
    })
  }, [draft, editor, applying, lastSynced])
}
