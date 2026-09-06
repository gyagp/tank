/** Fixed-step simulation follows elapsed time even when the Node timer wakes up late. */
export class SimulationClock {
  private accumulated = 0;
  constructor(
    private previous: number,
    private stepSeconds = 1 / 30,
  ) {}
  advance(now: number, step: (dt: number) => void): number {
    this.accumulated += Math.max(0, Math.min((now - this.previous) / 1000, 0.25));
    this.previous = now;
    let count = 0;
    while (this.accumulated + 1e-9 >= this.stepSeconds) {
      this.accumulated -= this.stepSeconds;
      step(this.stepSeconds);
      count++;
    }
    return count;
  }
}
