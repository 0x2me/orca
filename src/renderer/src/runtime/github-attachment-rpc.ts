import { callRuntimeRpc } from './runtime-rpc-client'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { unwrapRuntimeRpcResult } from './runtime-rpc-result'

/** A subscription owns cancellation of unary work too, including local IPC. */
export async function callGitHubAttachmentRpc<T>(
  target: RuntimeClientTarget,
  method: string,
  params: unknown,
  signal: AbortSignal,
  timeoutMs: number,
  options: Parameters<typeof callRuntimeRpc>[3] = {}
): Promise<T> {
  signal.throwIfAborted()
  if (target.kind !== 'local') {
    return callRuntimeRpc<T>(target, method, params, { ...options, signal, timeoutMs })
  }
  const response = await new Promise<RuntimeRpcResponse<unknown>>((resolve, reject) => {
    const subscriptionId = createBrowserUuid()
    let handle: { unsubscribe: () => void } | undefined
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      handle?.unsubscribe()
      if (!handle) {
        void window.api.runtime.cancelSubscription({ subscriptionId }).catch(() => {})
      }
      complete()
    }
    const abort = (): void =>
      finish(() =>
        reject(new Error('The GitHub image upload was interrupted. Your draft is kept; try again.'))
      )
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error('The GitHub image upload timed out. Your draft is kept; try again.'))
        ),
      timeoutMs
    )
    signal.addEventListener('abort', abort, { once: true })
    void window.api.runtime
      .subscribe({ subscriptionId, method, params, timeoutMs }, (result) =>
        finish(() => resolve(result))
      )
      .then((subscription) => {
        handle = subscription
        if (settled) {
          subscription.unsubscribe()
        }
      })
      .catch((error) => finish(() => reject(error)))
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: RPC dispatch validates each method response; T is the caller's result contract.
  return unwrapRuntimeRpcResult<T>(response as RuntimeRpcResponse<T>)
}
