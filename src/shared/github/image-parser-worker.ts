import { markdownImageDestinations, gitHubBodyImageError } from './markdown-image-parser'
import { isUnresolvedGitHubImage } from './markdown-image-destinations'
import { htmlImageDestinations } from './html-image-destinations'
import { assertGitHubImage, GitHubImageValidationError } from './image-attachment'
import { isValidBase64 } from '../rpc-contract/clipboard-params'
import {
  GITHUB_IMAGE_PARSE_FAILED,
  type GitHubImageParseRequest,
  type GitHubImageParseResponse,
  type GitHubImageSource
} from './image-parser-protocol'

function imageSource(source: string): GitHubImageSource {
  if (!isUnresolvedGitHubImage(source)) {
    return { source }
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(source)
  if (!match || !isValidBase64(match[2])) {
    throw new GitHubImageValidationError(
      'This image cannot be uploaded. Paste it again, or use an image URL.'
    )
  }
  const contentType = match[1].toLowerCase()
  const base64 = match[2]
  const bytes =
    Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  assertGitHubImage(contentType, bytes)
  return {
    source,
    upload: {
      contentType,
      fileName: `image.${contentType === 'image/svg+xml' ? 'svg' : contentType.slice(6)}`,
      base64Start: source.length - base64.length
    }
  }
}

export function processGitHubImageParse(
  request: GitHubImageParseRequest
): GitHubImageParseResponse {
  try {
    if (request.kind === 'validate') {
      return {
        id: request.id,
        ok: true,
        result: { kind: 'validate', error: gitHubBodyImageError(request.body) }
      }
    }
    if (request.kind === 'html') {
      const unique = new Map<string, ReturnType<typeof htmlImageDestinations>['images']>()
      const images = request.values.map((value) => {
        let result = unique.get(value)
        if (!result) {
          result = htmlImageDestinations(value, 0).images
          unique.set(value, result)
        }
        return result
      })
      return { id: request.id, ok: true, result: { kind: 'html', images } }
    }
    const images = markdownImageDestinations(request.body)
    const indices = new Map<string, number>()
    const sources: GitHubImageSource[] = []
    const destinations = images.map((image) => {
      if (isUnresolvedGitHubImage(image.source) && image.start < 0) {
        throw new GitHubImageValidationError(
          'This image cannot be replaced safely. Paste it again, or use an image URL.'
        )
      }
      let sourceIndex = indices.get(image.source)
      if (sourceIndex === undefined) {
        sourceIndex = sources.length
        indices.set(image.source, sourceIndex)
        sources.push(imageSource(image.source))
      }
      return { sourceIndex, start: image.start, end: image.end }
    })
    return {
      id: request.id,
      ok: true,
      result: { kind: 'prepare', preparation: { sources, destinations } }
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof GitHubImageValidationError ? error.message : GITHUB_IMAGE_PARSE_FAILED
    }
  }
}
