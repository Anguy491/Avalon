export class IdempotencyKeys {
  private pending: { fingerprint: string; key: string } | undefined;

  acquire(fingerprint: string, createId: () => string): string {
    if (this.pending?.fingerprint === fingerprint) return this.pending.key;
    const key = createId();
    this.pending = { fingerprint, key };
    return key;
  }

  complete(fingerprint: string): void {
    if (this.pending?.fingerprint === fingerprint) this.pending = undefined;
  }
}
