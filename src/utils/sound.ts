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

  public unlock() {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
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
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + durationSec + 0.02);
  }

  public playCountdownStep(step: number) {
    const freq = step === 1 ? 698.46 : step === 2 ? 587.33 : 523.25;
    this.playTone(freq, 0.14, 'triangle', 0.085);
  }

  public playQuestionStart() {
    this.playTone(783.99, 0.1, 'triangle', 0.08, 0);
    this.playTone(1046.5, 0.18, 'triangle', 0.09, 0.07);
  }

  public playTick(urgent = false, secLeft?: number) {
    if (urgent) {
      const freq = secLeft === 1 ? 1046.5 : secLeft === 2 ? 932.33 : 880;
      this.playTone(freq, 0.09, 'triangle', 0.08);
      return;
    }
    this.playTone(540, 0.045, 'sine', 0.032);
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
