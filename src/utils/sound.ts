class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    volume = 0.08,
    delaySec = 0
  ) {
    const ctx = this.getContext();
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }

  public playTick(urgent = false) {
    this.playTone(urgent ? 880 : 620, 0.08, 'triangle', urgent ? 0.08 : 0.045);
  }

  public playLockIn() {
    this.playTone(523.25, 0.09, 'sine', 0.07);
    this.playTone(659.25, 0.11, 'sine', 0.06, 0.05);
  }

  public playCorrect() {
    this.playTone(523.25, 0.14, 'triangle', 0.09, 0);
    this.playTone(659.25, 0.14, 'triangle', 0.09, 0.09);
    this.playTone(783.99, 0.24, 'triangle', 0.1, 0.18);
  }

  public playWrong() {
    this.playTone(260, 0.18, 'sawtooth', 0.05, 0);
    this.playTone(196, 0.28, 'sawtooth', 0.05, 0.12);
  }

  public playFanfare() {
    this.playTone(523.25, 0.14, 'triangle', 0.09, 0);
    this.playTone(659.25, 0.14, 'triangle', 0.09, 0.1);
    this.playTone(783.99, 0.14, 'triangle', 0.09, 0.2);
    this.playTone(1046.5, 0.4, 'triangle', 0.11, 0.3);
  }
}

export const soundEngine = new SoundEngine();
