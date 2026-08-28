export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export class AsyncGate {
  private activeReaders = 0
  private writerActive = false
  private readonly waiters: Array<{ kind: 'read' | 'write'; resolve: () => void }> = []

  async read<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireRead()
    try {
      return await operation()
    } finally {
      this.releaseRead()
    }
  }

  async write<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireWrite()
    try {
      return await operation()
    } finally {
      this.writerActive = false
      this.wakeNext()
    }
  }

  private async acquireRead(): Promise<void> {
    if (!this.writerActive && !this.waiters.some((waiter) => waiter.kind === 'write')) {
      this.activeReaders += 1
      return
    }
    await new Promise<void>((resolve) => this.waiters.push({
      kind: 'read',
      resolve: () => {
        this.activeReaders += 1
        resolve()
      },
    }))
  }

  private async acquireWrite(): Promise<void> {
    if (!this.writerActive && this.activeReaders === 0 && this.waiters.length === 0) {
      this.writerActive = true
      return
    }
    await new Promise<void>((resolve) => this.waiters.push({
      kind: 'write',
      resolve: () => {
        this.writerActive = true
        resolve()
      },
    }))
  }

  private releaseRead(): void {
    this.activeReaders -= 1
    if (this.activeReaders === 0) this.wakeNext()
  }

  private wakeNext(): void {
    if (this.activeReaders > 0 || this.writerActive) return
    const next = this.waiters.shift()
    if (!next) return
    next.resolve()

    // Readers already queued before the next writer may share the gate.
    if (next.kind === 'read') {
      while (this.waiters[0]?.kind === 'read') this.waiters.shift()!.resolve()
    }
  }
}
