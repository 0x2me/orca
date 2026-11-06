import { fromHtmlIsomorphic } from 'hast-util-from-html-isomorphic'
import type { MarkdownImageDestination } from './markdown-image-destinations'

const space = (char: string | undefined): boolean => char !== undefined && /[\t\n\f\r ]/.test(char)
const nameCharacter = (char: string | undefined): boolean =>
  char !== undefined && /[a-z0-9-]/i.test(char)

export function htmlImageDestinations(html: string, base: number) {
  const images: MarkdownImageDestination[] = []
  let index = 0
  let steps = 0
  let rawText: string | null = null
  while (index < html.length) {
    steps++
    if (html[index++] !== '<') {
      continue
    }
    const start = index - 1
    const closing = html[index] === '/'
    if (closing) {
      index++
    }
    if (!/[a-z]/i.test(html[index] ?? '')) {
      if (rawText || (html[index] !== '!' && html[index] !== '?')) {
        continue
      }
      const terminator = html.startsWith('!--', index)
        ? '-->'
        : html.startsWith('![CDATA[', index)
          ? ']]>'
          : '>'
      const end = html.indexOf(terminator, index)
      index = end === -1 ? html.length : end + terminator.length
      continue
    }
    const nameStart = index
    while (nameCharacter(html[index])) {
      steps++
      index++
    }
    const name = html.slice(nameStart, index).toLowerCase()
    const validName = space(html[index]) || html[index] === '/' || html[index] === '>'
    if (rawText && !validName) {
      continue
    }
    if (rawText && (!closing || name !== rawText)) {
      continue
    }
    let source: { start: number; end: number } | undefined
    let complete = false
    while (index < html.length) {
      steps++
      if (space(html[index]) || html[index] === '/') {
        index++
        continue
      }
      if (html[index] === '>') {
        index++
        complete = true
        break
      }
      const attributeStart = index
      while (index < html.length && !/[\t\n\f\r =/>]/.test(html[index])) {
        steps++
        index++
      }
      const attribute = html.slice(attributeStart, index).toLowerCase()
      while (space(html[index])) {
        steps++
        index++
      }
      if (html[index] !== '=') {
        continue
      }
      index++
      while (space(html[index])) {
        steps++
        index++
      }
      const quote = html[index] === '"' || html[index] === "'" ? html[index++] : null
      const valueStart = index
      while (
        index < html.length &&
        (quote ? html[index] !== quote : !space(html[index]) && html[index] !== '>')
      ) {
        steps++
        index++
      }
      if (attribute === 'src' && source === undefined) {
        source = { start: valueStart, end: index }
      }
      if (quote && html[index] === quote) {
        index++
      }
    }
    if (!complete) {
      break
    }
    if (!validName) {
      continue
    }
    if (rawText) {
      if (closing && name === rawText) {
        rawText = null
      }
      continue
    }
    if (!closing && /^(script|style|textarea|title)$/.test(name)) {
      rawText = name
      continue
    }
    if (closing || name !== 'img' || !source) {
      continue
    }
    const element = fromHtmlIsomorphic(html.slice(start, index), { fragment: true }).children.find(
      (child) => child.type === 'element' && child.tagName === 'img'
    )
    if (element?.type === 'element') {
      images.push({
        source: String(element.properties.src ?? ''),
        start: base + source.start,
        end: base + source.end
      })
    }
  }
  return { images, steps }
}
