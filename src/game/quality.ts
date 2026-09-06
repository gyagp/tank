/** Reduce render resolution on sustained slow frames, with slow recovery to prevent oscillation. */
export class AdaptiveQuality {
  scale: number;
  private elapsed = 0;
  private frames = 0;
  private healthy = 0;
  constructor(private maximum: number) {
    this.scale = maximum;
  }
  sample(seconds: number): boolean {
    // Very slow visible frames must still lower quality; only long suspensions are ignored.
    if (seconds <= 0 || seconds > 2) return false;
    this.elapsed += seconds;
    this.frames++;
    if (this.elapsed < 2) return false;
    const average = this.elapsed / this.frames;
    const previous = this.scale;
    if (average > 0.025) {
      this.scale = Math.max(0.65, this.scale - 0.15);
      this.healthy = 0;
    } else if (average < 0.018) {
      this.healthy += this.elapsed;
      if (this.healthy >= 10) {
        this.scale = Math.min(this.maximum, this.scale + 0.1);
        this.healthy = 0;
      }
    } else this.healthy = 0;
    this.elapsed = 0;
    this.frames = 0;
    return this.scale !== previous;
  }
}
