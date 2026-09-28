export function tangled(items: number[], flags: boolean[]): number {
  let total = 0
  for (const item of items) {
    if (item > 0) {
      for (const flag of flags) {
        if (flag && item % 2 === 0) {
          for (const other of items) {
            if (other > item || other < -item) {
              total += other
            }
          }
        } else if (!flag || item % 3 === 0) {
          total -= item
        } else {
          total += 1
        }
      }
    } else if (item < 0 && flags.length > 0) {
      total -= 1
    }
  }
  return total
}
