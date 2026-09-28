/**
 * A push-driven `AsyncIterable`: the streaming-input prompt of one live
 * `query()`. `sendTurn` and `steer` push user messages; closing the session
 * ends it, which lets the `claude` child see EOF on stdin and exit.
 */
export class Inbox<A> implements AsyncIterable<A> {
  private readonly buffer: A[] = []
  private waiter: ((result: IteratorResult<A>) => void) | null = null
  private ended = false

  push(value: A): boolean {
    if (this.ended) return false
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve({ value, done: false })
    } else {
      this.buffer.push(value)
    }
    return true
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve({ value: undefined, done: true })
    }
  }

  get isEnded(): boolean {
    return this.ended
  }

  [Symbol.asyncIterator](): AsyncIterator<A> {
    return {
      next: () => {
        const value = this.buffer.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => {
          this.waiter = resolve
        })
      },
      return: () => {
        this.end()
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}
