import { CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS } from '../../../shared/rpc-contract/clipboard-params'

export async function completeClipboardImageUpload<T>(
  contentBase64: string,
  uploadId: string,
  call: <R>(method: string, params: unknown) => Promise<R>,
  finish: () => Promise<T>
): Promise<T> {
  try {
    for (
      let offset = 0;
      offset < contentBase64.length;
      offset += CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
    ) {
      await call('clipboard.appendImageUploadChunk', {
        uploadId,
        offset,
        contentBase64: contentBase64.slice(
          offset,
          offset + CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
        )
      })
    }
    return await finish()
  } catch (error) {
    await call('clipboard.abortImageUpload', { uploadId }).catch(() => {})
    throw error
  }
}
