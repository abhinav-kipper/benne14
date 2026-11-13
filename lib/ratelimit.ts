// Slows down PIN guessing: after `max` wrong PINs from one address within `windowMs`, that address
// is locked out until the window passes. In memory, so each server instance counts on its own; that
// still turns 10,000 guesses into days of work instead of minutes.
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly max = 10, readonly windowMs = 10 * 60_000, private now = () => Date.now()) {}

  private recent(key: string) {
    const cut = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cut);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }

  locked(key: string) { return this.recent(key).length >= this.max; }

  fail(key: string) {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value!); // bound memory
  }
}
