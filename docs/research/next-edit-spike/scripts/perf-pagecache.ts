// perf-pagecache.ts <file> [evict]: the share of a file in the page cache; evict drops it with
// msync(MS_INVALIDATE) on a shared mapping, so a "cold" load reads the SSD without sudo purge. macOS.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { closeSync, fstatSync, openSync } from "node:fs";

const libc = dlopen("libc.dylib", {
  mmap: { args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64], returns: FFIType.ptr },
  munmap: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  mincore: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  msync: { args: [FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
});
const PROT_READ = 1, MAP_SHARED = 1, MS_INVALIDATE = 2, PAGE = 16384;

/** Fraction of the file's pages resident, after evicting them first when asked. */
export const residency = (path: string, evict = false) => {
  const fd = openSync(path, "r");
  const size = fstatSync(fd).size;
  const addr = libc.symbols.mmap(null, size, PROT_READ, MAP_SHARED, fd, 0)!;
  if (evict) libc.symbols.msync(addr, size, MS_INVALIDATE);
  const vec = new Uint8Array(Math.ceil(size / PAGE));
  libc.symbols.mincore(addr, size, ptr(vec));
  libc.symbols.munmap(addr, size);
  closeSync(fd);
  return vec.reduce((n, v) => n + (v & 1), 0) / vec.length;
};

if (import.meta.main) {
  const [file = "", mode = ""] = process.argv.slice(2);
  const before = residency(file);
  console.log(JSON.stringify({ before, after: mode === "evict" ? residency(file, true) : undefined }));
}
