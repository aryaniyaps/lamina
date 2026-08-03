import fs from 'node:fs';

const WINDOWS_DELAYED_DELETE_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

export function isDelayedWindowsDeleteError(error, platform = process.platform) {
  return platform === 'win32' && WINDOWS_DELAYED_DELETE_CODES.has(error?.code);
}

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
      !isDelayedWindowsDeleteError(error)
    ) {
      throw error;
    }
  }
}

export function throwLifecycleErrors(primaryError, cleanupErrors, context) {
  const errors = [primaryError, ...(cleanupErrors || [])].filter(Boolean);
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  const primary = primaryError
    ? `primary: ${primaryError.message}`
    : `cleanup: ${errors[0].message}`;
  const cleanup = errors.slice(1)
    .map((error) => error.message).join('; ');
  throw new AggregateError(
    errors,
    `${context} had multiple failures (${primary}${cleanup ? `; cleanup: ${cleanup}` : ''})`,
  );
}
