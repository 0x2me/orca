import type { MarkdownImageDestination } from './markdown-image-destinations'

export const GITHUB_IMAGE_PARSE_TIMEOUT_MS = 30_000
export const GITHUB_IMAGE_PARSE_QUEUE_BYTES = 64 * 1024 * 1024
export const GITHUB_IMAGE_PARSE_FAILED =
  'The description could not be prepared. Your draft is kept; try again.'

export class GitHubImageClassificationError extends Error {
  constructor(message = GITHUB_IMAGE_PARSE_FAILED) {
    super(message)
  }
}

export type GitHubImageSource = {
  source: string
  upload?: { contentType: string; fileName: string; base64Start: number }
}
export type GitHubImagePreparation = {
  sources: GitHubImageSource[]
  destinations: { sourceIndex: number; start: number; end: number }[]
}
export type GitHubImageParseInput =
  | { kind: 'validate'; body: string }
  | { kind: 'prepare'; body: string }
  | { kind: 'html'; values: string[] }
export type GitHubImageParseRequest = GitHubImageParseInput & { id: number }
export type GitHubImageParseResult =
  | { kind: 'validate'; error: string | null }
  | { kind: 'prepare'; preparation: GitHubImagePreparation }
  | { kind: 'html'; images: MarkdownImageDestination[][] }
export type GitHubImageParseResponse = { id: number } & (
  | { ok: true; result: GitHubImageParseResult }
  | { ok: false; error: string }
)

export function gitHubImageParseInputUnits(input: GitHubImageParseInput): number {
  return 'body' in input
    ? input.body.length
    : input.values.reduce((total, value) => total + value.length, 0)
}

export function preparedImageDestinations(
  preparation: GitHubImagePreparation
): MarkdownImageDestination[] {
  return preparation.destinations.map((image) => ({
    start: image.start,
    end: image.end,
    source: preparation.sources[image.sourceIndex].source
  }))
}
