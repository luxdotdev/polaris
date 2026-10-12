/** Bound open files and binary buffers while verifying large trees of small package files. */
export function* verificationBatches<A extends { readonly size: number }>(files: readonly A[]) {
  let batch: A[] = [];
  let bytes = 0;

  for (const file of files) {
    if (batch.length && (batch.length >= 32 || bytes + file.size > 16 * 1024 * 1024)) {
      yield batch;
      batch = [];
      bytes = 0;
    }

    batch.push(file);
    bytes += file.size;
  }

  if (batch.length) yield batch;
}
