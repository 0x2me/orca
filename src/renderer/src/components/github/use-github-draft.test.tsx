// @vitest-environment happy-dom

import { Suspense, startTransition, useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGitHubDraft } from './use-github-draft'

afterEach(cleanup)

it('keeps an accepted image submission when a replacement draft render never commits', async () => {
  let finishRead!: () => void
  const read = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  const suspended = new Promise<void>(() => {})
  const publish = vi.fn()
  const update = vi.fn()

  function Composer({ destination }: { destination: string }) {
    const draft = useGitHubDraft('original text', update, destination)
    if (destination === 'replacement') {
      throw suspended
    }
    return (
      <button
        onClick={() => {
          draft.read(async (signal) => {
            await read
            signal.throwIfAborted()
            draft.change('original text with image')
          })
          void draft.submit(publish, () => {})
        }}
      >
        Send original
      </button>
    )
  }
  function Screen() {
    const [destination, setDestination] = useState('original')
    return (
      <>
        <button onClick={() => startTransition(() => setDestination('replacement'))}>
          Switch draft
        </button>
        <Suspense fallback="Loading replacement">
          <Composer destination={destination} />
        </Suspense>
      </>
    )
  }

  const screen = render(<Screen />)
  fireEvent.click(screen.getByRole('button', { name: 'Send original' }))
  fireEvent.click(screen.getByRole('button', { name: 'Switch draft' }))
  expect(screen.queryByText('Loading replacement')).toBeNull()
  expect(screen.getByRole('button', { name: 'Send original' })).toBeTruthy()
  await act(async () => finishRead())
  await waitFor(() =>
    expect(publish).toHaveBeenCalledWith('original text with image', expect.any(AbortSignal))
  )
})
