import { parentPort } from 'node:worker_threads'
import { processGitHubImageParse } from '../../shared/github/image-parser-worker'
import type { GitHubImageParseRequest } from '../../shared/github/image-parser-protocol'

if (!parentPort) {
  throw new Error('GitHub image parser needs a worker parent port.')
}
const port = parentPort
port.on('message', (request: GitHubImageParseRequest) => {
  port.postMessage(processGitHubImageParse(request))
})
