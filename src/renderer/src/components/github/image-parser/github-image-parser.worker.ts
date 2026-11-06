import { processGitHubImageParse } from '../../../../../shared/github/image-parser-worker'
import type { GitHubImageParseRequest } from '../../../../../shared/github/image-parser-protocol'

self.onmessage = (event: MessageEvent<GitHubImageParseRequest>) => {
  self.postMessage(processGitHubImageParse(event.data))
}
