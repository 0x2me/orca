import { defaultTreeAdapter, html, parseFragment } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { MarkdownImageDestination } from './markdown-image-destinations'

/** Runs only in parser workers; source locations belong to the first effective attribute. */
export function htmlImageDestinations(value: string, base: number) {
  const context = defaultTreeAdapter.createElement('div', html.NS.HTML, [])
  const fragment = parseFragment(context, value, {
    scriptingEnabled: true,
    sourceCodeLocationInfo: true
  })
  const images: MarkdownImageDestination[] = []
  const pending: DefaultTreeAdapterMap['node'][] = [fragment]
  let nodes = 0
  let attributeUnits = 0
  while (pending.length) {
    const node = pending.pop()
    if (!node) {
      break
    }
    nodes++
    if ('tagName' in node && node.tagName === 'img' && node.namespaceURI === html.NS.HTML) {
      const source = node.attrs.find((attribute) => attribute.name === 'src')
      if (source) {
        const location = node.sourceCodeLocation?.attrs?.src
        let start = -1
        let end = -1
        if (location) {
          const span = value.slice(location.startOffset, location.endOffset)
          attributeUnits += span.length
          const equals = span.indexOf('=')
          if (equals !== -1) {
            let at = equals + 1
            while (/[\t\n\f\r ]/.test(span[at] ?? 'x')) {
              at++
            }
            const quote = span[at] === '"' || span[at] === "'" ? span[at++] : null
            const last = quote ? span.length - 1 : span.length
            if (last >= at && (!quote || span[last] === quote)) {
              start = base + location.startOffset + at
              end = base + location.startOffset + last
            }
          }
        }
        images.push({ source: source.value, start, end })
      }
    }
    // Template content lives in a separate inert fragment and is deliberately not traversed.
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        pending.push(node.childNodes[index])
      }
    }
  }
  return { images: images.sort((a, b) => a.start - b.start), nodes, attributeUnits }
}
