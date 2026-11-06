import { EventEmitter } from 'node:events'
import { processGitHubImageParse } from '../image-parser-worker'
import type { GitHubImageParseRequest, GitHubImageParseResponse } from '../image-parser-protocol'

/** Controlled process boundary; the actual parser and adapters remain under test. */
export class BrowserImageParserFixture {
  onmessage: ((event: MessageEvent<GitHubImageParseResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  postMessage(request: GitHubImageParseRequest): void {
    queueMicrotask(() =>
      this.onmessage?.(new MessageEvent('message', { data: processGitHubImageParse(request) }))
    )
  }
  terminate(): void {
    this.onmessage = null
  }
}

export class NodeImageParserFixture extends EventEmitter {
  postMessage(request: GitHubImageParseRequest): void {
    queueMicrotask(() => this.emit('message', processGitHubImageParse(request)))
  }
  unref(): void {}
  terminate(): Promise<number> {
    return Promise.resolve(0)
  }
}
