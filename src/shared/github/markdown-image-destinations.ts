import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes } from 'mdast'
import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'

export type MarkdownImageDestination = { source: string; start: number; end: number }
const parser = unified().use(remarkParse).use(remarkGfm)

function destinationRange(text: string, offset: number): { start: number; end: number } | null {
  let start = offset
  while (/\s/.test(text[start] ?? '') && start < text.length) {
    start++
  }
  if (text[start] === '<') {
    const end = text.indexOf('>', start + 1)
    return end === -1 ? null : { start: start + 1, end }
  }
  let end = start
  let depth = 0
  for (; end < text.length; end++) {
    const char = text[end]
    if (char === '\\') {
      end++
      continue
    }
    if (char === '(') {
      depth++
    }
    if (char === ')') {
      if (depth === 0) {
        break
      }
      depth--
    }
    if (/\s/.test(char)) {
      break
    }
  }
  return { start, end }
}

function destinationOpening(text: string, image: boolean): number {
  let depth = 1
  for (let index = image ? 2 : 1; index < text.length; index++) {
    if (text[index] === '\\') {
      index++
      continue
    }
    if (text[index] === '[') {
      depth++
    }
    if (text[index] === ']' && --depth === 0) {
      return text[index + 1] === (image ? '(' : ':') ? index + 2 : -1
    }
  }
  return -1
}

/** Keep source positions: serializing Markdown would rewrite unrelated draft text. */
export function markdownImageDestinations(markdown: string): MarkdownImageDestination[] {
  const tree = parser.parse(markdown)
  const references = new Set<string>()
  const definitions = new Map<string, Extract<Nodes, { type: 'definition' }>>()
  const images: MarkdownImageDestination[] = []
  const walk = (node: Nodes, collect: boolean): void => {
    if (!collect && node.type === 'imageReference') {
      references.add(node.identifier)
    }
    if (!collect && node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node)
    }
    if (
      collect &&
      (node.type === 'image' ||
        (node.type === 'definition' &&
          references.has(node.identifier) &&
          definitions.get(node.identifier) === node))
    ) {
      const base = node.position?.start.offset
      const end = node.position?.end.offset
      if (base !== undefined && end !== undefined) {
        const text = markdown.slice(base, end)
        // The AST already establishes that this span is an image/definition, not code.
        const opening = destinationOpening(text, node.type === 'image')
        const range = destinationRange(text, opening)
        if (opening > 1 && range) {
          images.push({ source: node.url, start: base + range.start, end: base + range.end })
        }
      }
    }
    if (collect && node.type === 'html') {
      const base = node.position?.start.offset
      if (base !== undefined) {
        // Browser HTML parsers omit positions; tokenize tags in the AST's eligible HTML span.
        const tags =
          /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?([a-z][a-z0-9-]*)(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/gi
        let rawText: string | null = null
        for (const token of node.value.matchAll(tags)) {
          const name = token[1]?.toLowerCase()
          const tag = token[0]
          if (!name) {
            continue
          }
          if (rawText) {
            if (tag.startsWith('</') && name === rawText) {
              rawText = null
            }
            continue
          }
          if (/^(script|style|textarea|title)$/.test(name) && !tag.startsWith('</')) {
            rawText = name
            continue
          }
          if (name !== 'img' || tag.startsWith('</')) {
            continue
          }
          const element = fromHtmlIsomorphic(tag, { fragment: true }).children.find(
            (child) => child.type === 'element' && child.tagName === 'img'
          )
          if (!element || element.type !== 'element') {
            continue
          }
          const attrs = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
          for (const match of tag.matchAll(attrs)) {
            if (
              match[1].toLowerCase() !== 'src' ||
              (match[2] === undefined && match[3] === undefined && match[4] === undefined)
            ) {
              continue
            }
            const raw = match[2] ?? match[3] ?? match[4]
            const valueOffset = match.index + match[0].indexOf('=') + 1
            const afterEquals = tag.slice(valueOffset).match(/^\s*["']?/)?.[0].length ?? 0
            const start = base + token.index + valueOffset + afterEquals
            images.push({
              source: String(element.properties.src ?? ''),
              start,
              end: start + raw.length
            })
            break
          }
        }
      }
    }
    if ('children' in node) {
      node.children.forEach((child) => walk(child, collect))
    }
  }
  walk(tree, false)
  walk(tree, true)
  return images.sort((a, b) => a.start - b.start)
}

export function isUnresolvedGitHubImage(source: string): boolean {
  const destination = source.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(destination) && !/^https?:/i.test(destination)
}

export function gitHubBodyImageError(body: string | undefined): string | null {
  return body &&
    markdownImageDestinations(body).some((image) => isUnresolvedGitHubImage(image.source))
    ? 'The image has not been uploaded to GitHub. Try again, or use an image URL.'
    : null
}

export function replaceMarkdownImageSource(body: string, source: string, url: string): string {
  const destinations = markdownImageDestinations(body).filter((image) => image.source === source)
  for (const image of destinations.toReversed()) {
    body = body.slice(0, image.start) + url + body.slice(image.end)
  }
  return body
}
