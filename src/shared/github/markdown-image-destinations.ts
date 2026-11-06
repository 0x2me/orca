import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Nodes, Data } from 'mdast'
import type { Extension } from 'mdast-util-from-markdown'
import { htmlImageDestinations } from './html-image-destinations'

export type MarkdownImageDestination = { source: string; start: number; end: number }
type ImageRangeData = Data & { imageDestination?: { start: number; end: number } }
const captureDestination: NonNullable<Extension['exit']>[string] = function (token) {
  const url = this.resume()
  const node = this.stack.at(-1)
  if (node?.type === 'image' || node?.type === 'link' || node?.type === 'definition') {
    node.url = url
    node.data ??= {}
    const data: ImageRangeData = node.data
    data.imageDestination = { start: token.start.offset, end: token.end.offset }
  }
}
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(function () {
    this.data('fromMarkdownExtensions', [
      ...(this.data('fromMarkdownExtensions') ?? []),
      {
        exit: {
          resourceDestinationString: captureDestination,
          definitionDestinationString: captureDestination
        }
      }
    ])
  })

function htmlNodeDestinations(
  markdown: string,
  node: Extract<Nodes, { type: 'html' }>
): MarkdownImageDestination[] {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  const images = htmlImageDestinations(node.value, 0).images
  if (!images.length) {
    return images
  }
  if (start === undefined || end === undefined) {
    return images.map((image) => ({ ...image, start: -1, end: -1 }))
  }
  if (markdown.slice(start, end) === node.value) {
    return images.map((image) => ({ ...image, start: start + image.start, end: start + image.end }))
  }
  // Markdown containers remove line prefixes from HTML values; match each line back to its source.
  const lines: { valueStart: number; valueEnd: number; sourceStart: number }[] = []
  let valueStart = 0
  let sourceStart = start
  while (valueStart < node.value.length && sourceStart < end) {
    const valueBreak = node.value.indexOf('\n', valueStart)
    const valueEnd = valueBreak === -1 ? node.value.length : valueBreak
    const sourceBreak = markdown.indexOf('\n', sourceStart)
    const sourceEnd = sourceBreak === -1 ? end : Math.min(end, sourceBreak)
    const valueLine = node.value.slice(valueStart, valueEnd).replace(/\r$/, '')
    const sourceLine = markdown.slice(sourceStart, sourceEnd).replace(/\r$/, '')
    lines.push({
      valueStart,
      valueEnd,
      sourceStart: sourceLine.endsWith(valueLine)
        ? sourceStart + sourceLine.length - valueLine.length
        : -1
    })
    valueStart = valueEnd + 1
    sourceStart = sourceEnd + 1
  }
  let lineIndex = 0
  return images.map((image) => {
    while (lineIndex + 1 < lines.length && lines[lineIndex].valueEnd < image.start) {
      lineIndex++
    }
    const line = lines[lineIndex]
    return !line || line.sourceStart < 0 || image.end > line.valueEnd
      ? { ...image, start: -1, end: -1 }
      : {
          ...image,
          start: line.sourceStart + image.start - line.valueStart,
          end: line.sourceStart + image.end - line.valueStart
        }
  })
}

/** Keep parser destination positions so replacements preserve all unrelated draft text. */
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
      const data: ImageRangeData | undefined = node.data
      const range = data?.imageDestination
      // Missing positions must never hide a rendered unresolved image from the writer validator.
      images.push({ source: node.url, start: range?.start ?? -1, end: range?.end ?? -1 })
    }
    if (collect && node.type === 'html') {
      images.push(...htmlNodeDestinations(markdown, node))
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

export function replaceMarkdownImageDestinations(
  body: string,
  destinations: MarkdownImageDestination[],
  replacements: ReadonlyMap<string, string>
): string {
  const parts: string[] = []
  let offset = 0
  for (const image of destinations) {
    const replacement = replacements.get(image.source)
    if (replacement === undefined) {
      continue
    }
    if (image.start < offset || image.end < image.start || image.end > body.length) {
      throw new Error('This image cannot be replaced safely. Paste it again, or use an image URL.')
    }
    parts.push(body.slice(offset, image.start), replacement)
    offset = image.end
  }
  parts.push(body.slice(offset))
  return parts.join('')
}

export function replaceMarkdownImageSource(body: string, source: string, url: string): string {
  return replaceMarkdownImageDestinations(
    body,
    markdownImageDestinations(body),
    new Map([[source, url]])
  )
}
