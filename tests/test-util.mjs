import fs from 'node:fs';

const WINDOWS_DELAYED_DELETE_CODES = new Set(['EBUSY', 'ENOTEMPTY']);

export function removeTemporaryTree(directory) {
  try {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 20 : 0,
      retryDelay: 100,
    });
  } catch (error) {
    // Windows can retain native database or daemon handles briefly after they
    // close. Assertions and shutdown checks are complete, and CI owns the temp
    // tree, so only delayed directory removal is non-fatal.
    if (
      process.platform !== 'win32' ||
      !WINDOWS_DELAYED_DELETE_CODES.has(error.code)
    ) {
      throw error;
    }
  }
}
