export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private nextShotAt = 0;
  private nextSpecialAt = 0;
  muted = false;
  volume = 0.35;
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  play(
    kind:
      | 'shot'
      | 'hit'
      | 'explosion'
      | 'pickup'
      | 'dash'
      | 'arc'
      | 'strike'
      | 'frost'
      | 'smoke'
      | 'radar'
      | 'capture',
    distance = 0,
  ) {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx,
      now = ctx.currentTime;
    if (distance > 32) return;
    if (kind === 'shot') {
      if (now < this.nextShotAt) return;
      this.nextShotAt = now + 0.045;
    }
    this.master.gain.value = this.volume;
    if (kind === 'radar' || kind === 'capture') kind = 'pickup';
    if (kind === 'smoke') kind = 'dash';
    if (kind === 'strike') kind = 'explosion';
    if (kind === 'arc' || kind === 'frost') {
      if (now < this.nextSpecialAt) return;
      this.nextSpecialAt = now + 0.09;
      const tone = ctx.createOscillator(),
        envelope = ctx.createGain();
      tone.type = kind === 'arc' ? 'sawtooth' : 'sine';
      tone.frequency.setValueAtTime(kind === 'arc' ? 1350 : 850, now);
      tone.frequency.exponentialRampToValueAtTime(kind === 'arc' ? 100 : 180, now + 0.23);
      envelope.gain.setValueAtTime(0.08 * Math.max(0.05, 1 - distance / 40), now);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      tone.connect(envelope);
      envelope.connect(this.master);
      tone.start();
      tone.stop(now + 0.31);
      tone.onended = () => {
        tone.disconnect();
        envelope.disconnect();
      };
      return;
    }
    const gain = ctx.createGain();
    gain.connect(this.master);
    const level = Math.max(0.05, 1 - distance / 40);
    if (kind === 'pickup' || kind === 'dash') {
      const osc = ctx.createOscillator();
      osc.type = kind === 'pickup' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(kind === 'pickup' ? 560 : 130, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'pickup' ? 1120 : 300, now + 0.15);
      gain.gain.setValueAtTime(0.2 * level, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      osc.start();
      osc.stop(now + 0.26);
      return;
    }
    const duration = kind === 'explosion' ? 0.65 : kind === 'shot' ? 0.14 : 0.08;
    let buffer = this.buffers.get(kind);
    if (!buffer) {
      buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      this.buffers.set(kind, buffer);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(
      kind === 'explosion' ? 650 : kind === 'shot' ? 1900 : 3500,
      now,
    );
    filter.frequency.exponentialRampToValueAtTime(60, now + duration);
    gain.gain.setValueAtTime((kind === 'explosion' ? 0.85 : 0.25) * level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(filter);
    filter.connect(gain);
    noise.start();
    noise.stop(now + duration);
    if (kind !== 'hit') {
      const osc = ctx.createOscillator(),
        bass = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'shot' ? 150 : 85, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + duration);
      bass.gain.setValueAtTime(0.35 * level, now);
      bass.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(bass);
      bass.connect(this.master);
      osc.start();
      osc.stop(now + duration);
    }
  }
  destroy() {
    this.buffers.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
