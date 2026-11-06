export type MarkdownImageDestination = { source: string; start: number; end: number }

export function mayContainGitHubImage(body: string): boolean {
  return body.includes('![') || body.includes('<')
}

export function isUnresolvedGitHubImage(source: string): boolean {
  const destination = source.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(destination) && !/^https?:/i.test(destination)
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
