// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { useRef, useState, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedDroppedPaths } from '../../../shared/native-file-drop-preparation'

const electron = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  getPathForFile: vi.fn((file: File) => `/dropped/${file.name}`)
}))

vi.mock('electron', () => ({
  ipcRenderer: electron,
  webUtils: { getPathForFile: electron.getPathForFile }
}))

import { createOsFileDropSequence, useOsFileDropOwner } from '../hooks/use-os-file-drop-owner'
import { WORKSPACE_FILE_PATHS_MIME } from './workspace-file-drag'
import { installOsFileDropCancellationGuard } from './os-file-drop-cancellation-guard'

const prepareDroppedPaths = vi.fn(
  async ({ paths }: { paths: string[] }): Promise<PreparedDroppedPaths> => ({ paths, failures: [] })
)

function OwnerProbe({
  onDrop
}: {
  onDrop: (prepared: PreparedDroppedPaths) => void
}): React.JSX.Element {
  const ownerElementRef = useRef<HTMLElement | null>(null)
  const [sequence] = useState(createOsFileDropSequence)
  const attach = useOsFileDropOwner(ownerElementRef, {
    consumer: 'agent',
    sequence,
    onDrop: (prepared) => onDrop(prepared)
  })
  return (
    <div ref={attach}>
      <span data-testid="target" />
    </div>
  )
}

function FileOwnerProbe({
  onFiles,
  canAccept = true,
  children
}: {
  onFiles: (files: File[]) => void
  canAccept?: boolean
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const attach = useOsFileDropOwner(ref, { kind: 'files', canAccept, onFiles })
  return <div ref={attach}>{children}</div>
}

function drag(
  target: Element,
  type: 'dragover' | 'drop',
  trusted = true,
  types = ['Files']
): {
  event: Event
  transfer: { dropEffect: string }
} {
  const transfer = {
    types,
    files: [new File(['a'], 'a.txt')],
    dropEffect: 'move'
  }
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  Object.defineProperty(event, 'isTrusted', { value: trusted })
  act(() => {
    target.dispatchEvent(event)
  })
  return { event, transfer }
}

let disposeGuard: (() => void) | null = null

beforeAll(async () => {
  // Exercise the stacked base's preload setup when replaying this regression.
  const preload = await import('../../../preload/preload-runtime-support')
  if (
    'installNativeFileDropHandlers' in preload &&
    typeof preload.installNativeFileDropHandlers === 'function'
  ) {
    preload.installNativeFileDropHandlers()
  }
})

beforeEach(() => {
  vi.stubGlobal('api', { fs: { getPathForFile: electron.getPathForFile, prepareDroppedPaths } })
  electron.send.mockClear()
  electron.getPathForFile.mockClear()
  prepareDroppedPaths.mockClear()
  disposeGuard = installOsFileDropCancellationGuard()
})

afterEach(() => {
  cleanup()
  disposeGuard?.()
  disposeGuard = null
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('preload and renderer file drop guard', () => {
  it('refuses unowned chrome without opening, uploading, or showing a toast', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const hover = drag(target, 'dragover')
    expect(hover.event.defaultPrevented).toBe(true)
    expect(hover.transfer.dropEffect).toBe('none')

    const dropped = drag(target, 'drop')
    await act(async () => undefined)
    expect(dropped.event.defaultPrevented).toBe(true)
    expect(dropped.transfer.dropEffect).toBe('none')
    expect(electron.send).not.toHaveBeenCalled()
    expect(electron.getPathForFile).not.toHaveBeenCalled()
    expect(prepareDroppedPaths).not.toHaveBeenCalled()
  })

  it('lets a registered owner claim the real event and keep the copy cursor', async () => {
    const onDrop = vi.fn()
    const view = render(<OwnerProbe onDrop={onDrop} />)
    const target = view.getByTestId('target')
    const hover = drag(target, 'dragover')
    expect(hover.transfer.dropEffect).toBe('copy')
    drag(target, 'drop')
    await act(async () => undefined)
    expect(electron.send).not.toHaveBeenCalled()
    expect(prepareDroppedPaths).toHaveBeenCalledExactlyOnceWith({
      paths: ['/dropped/a.txt'],
      consumer: 'agent'
    })
    expect(onDrop).toHaveBeenCalledExactlyOnceWith({
      paths: ['/dropped/a.txt'],
      failures: []
    })
  })
})

it('delivers File bytes synchronously to only the nearest available trusted owner without path preparation', () => {
  const outer = vi.fn()
  const inner = vi.fn()
  function Owners({ available = true }) {
    return (
      <FileOwnerProbe onFiles={outer}>
        <FileOwnerProbe onFiles={inner} canAccept={available}>
          <span data-testid="file-target" />
        </FileOwnerProbe>
      </FileOwnerProbe>
    )
  }
  const view = render(<Owners />)
  const target = view.getByTestId('file-target')
  drag(target, 'drop')
  expect(inner).toHaveBeenCalledOnce()
  expect(inner.mock.calls[0][0][0]).toBeInstanceOf(File)
  expect(inner.mock.calls[0][0][0].name).toBe('a.txt')
  expect(outer).not.toHaveBeenCalled()
  inner.mockClear()
  view.rerender(<Owners available={false} />)
  drag(target, 'drop')
  expect(inner).not.toHaveBeenCalled()
  expect(outer).not.toHaveBeenCalled()
  view.rerender(<Owners />)
  drag(target, 'drop', false)
  drag(target, 'drop', true, ['Files', WORKSPACE_FILE_PATHS_MIME])
  expect(inner).not.toHaveBeenCalled()
  expect(outer).not.toHaveBeenCalled()
  expect(electron.getPathForFile).not.toHaveBeenCalled()
  expect(prepareDroppedPaths).not.toHaveBeenCalled()
  view.unmount()
  drag(target, 'drop')
  expect(inner).not.toHaveBeenCalled()
})
