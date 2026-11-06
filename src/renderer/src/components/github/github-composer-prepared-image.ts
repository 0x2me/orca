import { useEffect, type RefObject } from 'react'
import type { GitHubDraft, GitHubPreparedImage } from './use-github-draft'
import type { Editor } from '@tiptap/react'
import {
  replaceMarkdownImageDestinations,
  type MarkdownImageDestination
} from '../../../../shared/github/markdown-image-destinations'
import { indexGitHubEditorHtml } from './image-parser/github-image-parser'

/** Attributes preserve node positions; index the frozen editor before any upload can complete. */
function createGitHubPreparedImageUpdater(editor: Editor) {
  let attempt: object | undefined
  const positions = new Map<string, Set<number>>()
  const rawNodes = new Map<
    number,
    { value: string; destinations: MarkdownImageDestination[]; urls: Map<string, string> }
  >()
  return {
    prepare: async (context: {
      attempt: object
      signal: AbortSignal
      sources: readonly string[]
    }): Promise<void> => {
      const document = editor.state.doc
      const nodes: { position: number; source?: string; value?: string }[] = []
      const values = new Map<string, number>()
      document.descendants((node, position) => {
        if (node.type.name === 'image' && typeof node.attrs.src === 'string') {
          nodes.push({ position, source: node.attrs.src })
        }
        if (
          (node.type.name === 'rawMarkdownHtmlInline' ||
            node.type.name === 'rawMarkdownHtmlBlock') &&
          typeof node.attrs.value === 'string'
        ) {
          nodes.push({ position, value: node.attrs.value })
          if (!values.has(node.attrs.value)) {
            values.set(node.attrs.value, values.size)
          }
        }
      })
      const results = await indexGitHubEditorHtml([...values.keys()], context.signal)
      context.signal.throwIfAborted()
      if (editor.isDestroyed || editor.state.doc !== document) {
        throw new Error('The description changed. Your draft is kept; try again.')
      }
      positions.clear()
      rawNodes.clear()
      const add = (source: string, position: number): void => {
        let entries = positions.get(source)
        if (!entries) {
          positions.set(source, (entries = new Set()))
        }
        entries.add(position)
      }
      for (const node of nodes) {
        if (node.source !== undefined) {
          add(node.source, node.position)
        }
        if (node.value !== undefined) {
          const index = values.get(node.value)
          const destinations = index === undefined ? [] : results[index]
          if (!destinations || destinations.some((image) => image.start < 0)) {
            throw new Error(
              'This image cannot be replaced safely. Paste it again, or use an image URL.'
            )
          }
          rawNodes.set(node.position, { value: node.value, destinations, urls: new Map() })
          destinations.forEach((image) => add(image.source, node.position))
        }
      }
      if (context.sources.some((source) => !positions.has(source))) {
        throw new Error(
          'This image cannot be replaced safely. Paste it again, or use an image URL.'
        )
      }
      attempt = context.attempt
    },
    replace: (image: GitHubPreparedImage): void => {
      const matches = positions.get(image.source)
      if (attempt !== image.attempt || !matches?.size) {
        throw new Error('The description changed. Your draft is kept; try again.')
      }
      const transaction = editor.state.tr
      for (const position of matches) {
        const node = transaction.doc.nodeAt(position)
        if (!node) {
          throw new Error('The description changed. Your draft is kept; try again.')
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
    }
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
    const updater = createGitHubPreparedImageUpdater(editor)
    const unsubscribePreparation = draft.subscribeImagePreparation(updater.prepare)
    const unsubscribeReplacement = draft.subscribeImageReplacement((image) => {
      if (editor.isDestroyed) {
        return
      }
      applying.current = true
      try {
        updater.replace(image)
        lastSynced.current = image.body
      } finally {
        applying.current = false
      }
    })
    return () => {
      unsubscribePreparation()
      unsubscribeReplacement()
    }
  }, [draft, editor, applying, lastSynced])
}
