import { parse, postprocess, preprocess } from 'micromark'
import { gfm } from 'micromark-extension-gfm'
import { decodeString } from 'micromark-util-decode-string'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'
import { htmlImageDestinations } from './html-image-destinations'
import {
  mayContainGitHubImage,
  isUnresolvedGitHubImage,
  type MarkdownImageDestination
} from './markdown-image-destinations'

type Event = ReturnType<typeof postprocess>[number]
type Destination = { token: Event[1]; context: Event[2] }
type Definition = { id?: string; destination?: Destination }
type Media = {
  type: 'image' | 'link'
  rendered: boolean
  resource?: boolean
  label?: Event[1]
  reference?: Event[1]
}
type Record =
  | { definition: Definition }
  | { destination: Destination }
  | { html: MarkdownImageDestination[] }

function htmlDestinations(markdown: string, value: string, token: Event[1]) {
  const images = htmlImageDestinations(value, 0).images
  if (!images.length) {
    return images
  }
  const start = token.start.offset
  const end = token.end.offset
  if (markdown.slice(start, end) === value) {
    return images.map((image) =>
      image.start < 0 ? image : { ...image, start: start + image.start, end: start + image.end }
    )
  }
  // Container prefixes are absent from parsed HTML; map each line back once.
  const lines: { start: number; end: number; source: number }[] = []
  let at = 0
  let sourceAt = start
  while (at < value.length && sourceAt < end) {
    const nextBreak = value.indexOf('\n', at)
    const next = nextBreak === -1 ? value.length : nextBreak
    const sourceBreak = markdown.indexOf('\n', sourceAt)
    const sourceNext = sourceBreak === -1 ? end : Math.min(end, sourceBreak)
    const line = value.slice(at, next).replace(/\r$/, '')
    const sourceLine = markdown.slice(sourceAt, sourceNext).replace(/\r$/, '')
    lines.push({
      start: at,
      end: next,
      source: sourceLine.endsWith(line) ? sourceAt + sourceLine.length - line.length : -1
    })
    at = next + 1
    sourceAt = sourceNext + 1
  }
  let index = 0
  return images.map((image) => {
    while (index + 1 < lines.length && lines[index].end < image.start) {
      index++
    }
    const line = lines[index]
    return image.start < 0 || !line || line.source < 0 || image.end > line.end
      ? { ...image, start: -1, end: -1 }
      : {
          ...image,
          start: line.source + image.start - line.start,
          end: line.source + image.end - line.start
        }
  })
}

/** Worker-only resolved grammar events avoid constructing an unrelated document AST. */
export function parseMarkdownImageDestinations(markdown: string) {
  const stats = { eventVisits: 0, serializedUnits: 0, decodedDestinations: 0 }
  if (!mayContainGitHubImage(markdown)) {
    return { images: [] as MarkdownImageDestination[], stats }
  }
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(markdown, undefined, true))
  )
  const records: Record[] = []
  const used = new Set<string>()
  const definitions = new Map<string, Definition>()
  const media: Media[] = []
  let imageDepth = 0
  let definition: Definition | undefined
  const serialize = (token: Event[1], context: Event[2]): string => {
    const value = context.sliceSerialize(token)
    stats.serializedUnits += value.length
    return value
  }
  for (const [kind, token, context] of events) {
    stats.eventVisits++
    if (token.type === 'image' || token.type === 'link') {
      if (kind === 'enter') {
        media.push({ type: token.type, rendered: imageDepth === 0 })
        if (token.type === 'image') {
          imageDepth++
        }
      } else {
        const frame = media.pop()
        if (frame?.type === 'image') {
          imageDepth--
          if (frame.rendered && !frame.resource && frame.label) {
            used.add(normalizeIdentifier(serialize(frame.reference ?? frame.label, context)))
          }
        }
      }
      continue
    }
    const frame = media.at(-1)
    if (kind === 'enter' && token.type === 'definition') {
      definition = {}
    }
    if (kind === 'exit' && token.type === 'definitionLabelString' && definition) {
      definition.id = normalizeIdentifier(serialize(token, context))
    }
    if (kind === 'exit' && token.type === 'definitionDestinationString' && definition) {
      definition.destination = { token, context }
    }
    if (kind === 'exit' && token.type === 'definition') {
      if (definition?.id && !definitions.has(definition.id)) {
        definitions.set(definition.id, definition)
        records.push({ definition })
      }
      definition = undefined
    }
    if (kind === 'enter' && token.type === 'resource' && frame) {
      frame.resource = true
    }
    if (kind === 'exit' && token.type === 'labelText' && frame) {
      frame.label = token
    }
    if (kind === 'exit' && token.type === 'referenceString' && frame) {
      frame.reference = token
    }
    if (
      kind === 'exit' &&
      token.type === 'resourceDestinationString' &&
      frame?.type === 'image' &&
      frame.rendered
    ) {
      records.push({ destination: { token, context } })
    }
    if (
      kind === 'exit' &&
      (token.type === 'htmlFlow' || token.type === 'htmlText') &&
      imageDepth === 0
    ) {
      records.push({ html: htmlDestinations(markdown, serialize(token, context), token) })
    }
  }
  const images: MarkdownImageDestination[] = []
  for (const record of records) {
    stats.eventVisits++
    if ('html' in record) {
      images.push(...record.html)
      continue
    }
    const destination =
      'destination' in record
        ? record.destination
        : record.definition.id && used.has(record.definition.id)
          ? record.definition.destination
          : undefined
    if (!destination) {
      continue
    }
    stats.decodedDestinations++
    images.push({
      source: decodeString(serialize(destination.token, destination.context)),
      start: destination.token.start.offset,
      end: destination.token.end.offset
    })
  }
  // HTML foster parenting can change tree order; sort the required output once.
  return { images: images.sort((a, b) => a.start - b.start), stats }
}

export function markdownImageDestinations(body: string): MarkdownImageDestination[] {
  return parseMarkdownImageDestinations(body).images
}

export function gitHubBodyImageError(body: string | undefined): string | null {
  return body &&
    markdownImageDestinations(body).some((image) => isUnresolvedGitHubImage(image.source))
    ? 'The image has not been uploaded to GitHub. Try again, or use an image URL.'
    : null
}
