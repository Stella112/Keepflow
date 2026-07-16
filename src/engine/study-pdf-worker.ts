/**
 * Kept as an eval worker source so the same isolated parser works from both
 * TypeScript/Vitest and the compiled `dist` tree. The worker receives only a
 * transferred byte buffer, never a URL, and has no application secrets or
 * tools. Its parent applies the memory, concurrency, and wall-clock limits.
 */
export const STUDY_PDF_WORKER_SOURCE = String.raw`
'use strict';

const { parentPort } = require('node:worker_threads');

if (!parentPort) {
  throw new Error('study PDF worker requires a parent port');
}

function safeErrorCode(error) {
  const name = error && typeof error.name === 'string' ? error.name : '';
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (/password/i.test(name) || /password|encrypted/i.test(message)) {
    return 'pdf_encrypted';
  }
  if (error && error.code === 'pdf_page_limit') return 'pdf_page_limit';
  return 'pdf_malformed';
}

parentPort.once('message', async (message) => {
  let bytes;
  let document;
  try {
    if (!message || !(message.bytes instanceof ArrayBuffer)) {
      throw new Error('invalid worker payload');
    }
    bytes = new Uint8Array(message.bytes);

    const { extractText, getDocumentProxy } = await import('unpdf');
    document = await getDocumentProxy(bytes, {
      stopAtErrors: true,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      enableXfa: false,
      maxImageSize: 1000000,
      verbosity: 0,
    });

    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new Error('PDF has no pages');
    }
    if (document.numPages > 40) {
      const error = new Error('PDF exceeds page limit');
      error.code = 'pdf_page_limit';
      throw error;
    }

    const result = await extractText(document, { mergePages: false });
    parentPort.postMessage({
      ok: true,
      totalPages: result.totalPages,
      pages: result.text,
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: safeErrorCode(error) });
  } finally {
    try {
      if (document) await document.destroy();
    } catch {
      // Best-effort parser cleanup only.
    }
    if (bytes) bytes.fill(0);
  }
});
`;
