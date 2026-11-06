import { describe, expect, it } from 'vitest'
import { htmlImageDestinations } from './html-image-destinations'
import {
  parseMarkdownImageDestinations,
  gitHubBodyImageError,
  markdownImageDestinations
} from './markdown-image-parser'
import { replaceMarkdownImageDestinations } from './markdown-image-destinations'
function replaceMarkdownImageSource(body: string, source: string, url: string) {
  return replaceMarkdownImageDestinations(
    body,
    markdownImageDestinations(body),
    new Map([[source, url]])
  )
}

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

  it('bounds HTML output work and respects quoted attributes, comments and raw text', () => {
    for (const size of [1000, 10000]) {
      const html = `<div>\n<a${' '.repeat(size)}x\n`
      const result = htmlImageDestinations(html, 0)
      // Output traversal and attribute slicing remain bounded by the owned HTML input.
      expect(result.nodes).toBeLessThanOrEqual(html.length)
      expect(result.attributeUnits).toBeLessThanOrEqual(html.length)
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

it.each(['<!-->', '<!--->', '<!-- comment --!>'])(
  'finds a rendered image after HTML comment termination %s',
  (comment) => {
    const source = 'data:image/png;base64,YQ=='
    const body = `${comment}<img alt="Screenshot" src="${source}">`
    expect(
      markdownImageDestinations(body).map((image) => body.slice(image.start, image.end))
    ).toEqual([source])
    expect(gitHubBodyImageError(body)).toContain('not been uploaded')
    expect(replaceMarkdownImageSource(body, source, 'https://example.com/image.png')).toBe(
      `${comment}<img alt="Screenshot" src="https://example.com/image.png">`
    )
  }
)

it('uses HTML context and source order through foreign integration, inert templates and foster parenting', () => {
  const body =
    '<div><template><img src="data:inert"></template><svg><image src="data:foreign"/><foreignObject><img src="data:html"></foreignObject></svg><table><img src="data:first"><tr><td><img src="data:second"></td></tr></table></div>'
  expect(
    markdownImageDestinations(body).map((image) => body.slice(image.start, image.end))
  ).toEqual(['data:html', 'data:first', 'data:second'])
})

it.each([10, 100])(
  'bounds required event collection and serialization for %i distinct references',
  (count) => {
    const body = Array.from(
      { length: count },
      (_, index) =>
        `- entry ![shot${index}][ref${index}]\n\n[ref${index}]: data:image/png;base64,YQ==\n`
    ).join('\n')
    const { images, stats } = parseMarkdownImageDestinations(body)
    expect(images).toHaveLength(count)
    expect(stats.eventVisits).toBeLessThan(body.length * 2)
    expect(stats.serializedUnits).toBeLessThan(body.length)
  }
)
