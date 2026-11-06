import { describe, expect, it } from 'vitest'
import { htmlImageDestinations } from './html-image-destinations'
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

  it('keeps literal alt brackets and continued blockquote definition destinations intact', () => {
    const source = 'data:image/png;base64,YQ=='
    const body = `![before \`[\` after](${source})\n\n> [shot]:\n> ${source}\n\n![screen][shot]`
    expect(
      markdownImageDestinations(body).map((image) => body.slice(image.start, image.end))
    ).toEqual([source, source])
    expect(gitHubBodyImageError(body)).toContain('not been uploaded')
    expect(replaceMarkdownImageSource(body, source, 'https://example.com/image.png')).toBe(
      '![before `[` after](https://example.com/image.png)\n\n> [shot]:\n> https://example.com/image.png\n\n![screen][shot]'
    )
  })

  it('scans hostile HTML in linear work and respects quoted attributes, comments and raw text', () => {
    for (const size of [1000, 10000]) {
      const html = `<div>\n<a${' '.repeat(size)}x\n`
      const result = htmlImageDestinations(html, 0)
      // One forward visit per input character plus tag/attribute transitions, independent of whitespace runs.
      expect(result.steps).toBeLessThanOrEqual(2 * html.length)
      expect(result.images).toEqual([])
    }
    const body =
      '<div>\n<!-- <img src="data:ignored"> -->\n<script>"<img src=\'data:ignored\'>"</script>\n<textarea><img src="data:ignored"></textarea>\n<img alt=" > < " src="data:image/png;base64,YQ==">'
    expect(markdownImageDestinations(body).map((image) => image.source)).toEqual([
      'data:image/png;base64,YQ=='
    ])
  })
})

it('preserves container prefixes when replacing a multiline HTML image', () => {
  const source = 'data:image/png;base64,YQ=='
  const body = `> <img\n> alt="Screenshot"\n> src="${source}">\n\n- <img\n  src="${source}">`
  expect(
    markdownImageDestinations(body).map((image) => body.slice(image.start, image.end))
  ).toEqual([source, source])
  expect(replaceMarkdownImageSource(body, source, 'https://example.com/image.png')).toBe(
    '> <img\n> alt="Screenshot"\n> src="https://example.com/image.png">\n\n- <img\n  src="https://example.com/image.png">'
  )
})
