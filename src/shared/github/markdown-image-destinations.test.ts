import { describe, expect, it } from 'vitest'
import {
  gitHubBodyImageError,
  markdownImageDestinations,
  replaceMarkdownImageSource
} from './markdown-image-destinations'

describe('GitHub image destinations', () => {
  it('replaces rendered destinations without changing titles, Unicode, code or unused definitions', () => {
    const source = 'data:image/png;base64,AA=='
    const body = `👋 ![a [nested]](<${source}> "title ]( intact")\n![b][screen]\n\n[screen]: <${source}> 'label'\n\n<img alt="x" src='${source}'>\n\n\`${source}\`\n\n\`\`\`md\n![code](${source})\n\`\`\`\n[unused]: ${source}\n`
    expect(markdownImageDestinations(body).map((image) => image.source)).toEqual([
      source,
      source,
      source
    ])
    expect(
      replaceMarkdownImageSource(body, source, 'https://github.com/user-attachments/assets/a')
    ).toBe(
      `👋 ![a [nested]](<https://github.com/user-attachments/assets/a> "title ]( intact")\n![b][screen]\n\n[screen]: <https://github.com/user-attachments/assets/a> 'label'\n\n<img alt="x" src='https://github.com/user-attachments/assets/a'>\n\n\`${source}\`\n\n\`\`\`md\n![code](${source})\n\`\`\`\n[unused]: ${source}\n`
    )
  })

  it('refuses unresolved images but allows hosted/repository images and examples', () => {
    expect(gitHubBodyImageError('![x](data:image/png;base64,AA==)')).toContain('not been uploaded')
    expect(gitHubBodyImageError('![x](blob:https://orca.app/id)')).toContain('not been uploaded')
    expect(gitHubBodyImageError('<img src="file:///tmp/screenshot.png">')).toContain(
      'not been uploaded'
    )
    expect(
      gitHubBodyImageError(
        '![hosted](https://example.com/a.png)\n![repo](docs/a.png)\n`![example](data:image/png;base64,AA==)`'
      )
    ).toBeNull()
  })
})
