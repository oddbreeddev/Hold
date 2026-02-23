
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private droneG: GainNode | null = null;
  private harmonic: OscillatorNode | null = null;
  private harmonicG: GainNode | null = null;
  private pulseInterval: any = null;

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      console.error("Audio Engine failed to init", e);
    }
  }

  startDrone() {
    if (!this.ctx || !this.master || this.drone) return;
    
    // Main Drone
    this.drone = this.ctx.createOscillator();
    this.droneG = this.ctx.createGain();
    this.drone.type = "sine";
    this.drone.frequency.value = 120;
    this.droneG.gain.value = 0;
    this.drone.connect(this.droneG);
    this.droneG.connect(this.master);
    this.drone.start();
    this.droneG.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.1);

    // Harmonic for Zone Entry (initially silent)
    this.harmonic = this.ctx.createOscillator();
    this.harmonicG = this.ctx.createGain();
    this.harmonic.type = "triangle";
    this.harmonic.frequency.value = 240;
    this.harmonicG.gain.value = 0;
    this.harmonic.connect(this.harmonicG);
    this.harmonicG.connect(this.master);
    this.harmonic.start();

    // Start Rhythmic Pulse
    this.startPulse();
  }

  private startPulse() {
    let beat = 0;
    this.pulseInterval = setInterval(() => {
      if (!this.ctx || !this.master) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(60, this.ctx.currentTime);
      g.gain.setValueAtTime(0.1, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
      beat++;
    }, 200); // 120 BPM base
  }

  updateGameState(radius: number, inZone: boolean, speed: number) {
    if (!this.ctx || !this.drone || !this.droneG || !this.harmonicG) return;
    
    const time = this.ctx.currentTime;
    
    // Rise frequency with radius
    this.drone.frequency.setTargetAtTime(120 + (radius * 1.2), time, 0.05);
    
    // Enable harmonic when in zone
    const targetHarmonicGain = inZone ? 0.08 : 0;
    this.harmonicG.gain.setTargetAtTime(targetHarmonicGain, time, 0.03);
    if (this.harmonic) {
      this.harmonic.frequency.setTargetAtTime((120 + (radius * 1.2)) * 2, time, 0.05);
    }
  }

  stopDrone() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }

    if (this.droneG && this.ctx) {
      const time = this.ctx.currentTime;
      this.droneG.gain.linearRampToValueAtTime(0, time + 0.1);
      if (this.harmonicG) this.harmonicG.gain.linearRampToValueAtTime(0, time + 0.1);
      
      const d = this.drone;
      const h = this.harmonic;
      setTimeout(() => {
        try {
          d?.stop();
          h?.stop();
        } catch(e){}
      }, 120);
      this.drone = null;
      this.harmonic = null;
    }
  }

  playSuccess(combo: number) {
    if (!this.ctx || !this.master) return;
    const time = this.ctx.currentTime;
    const baseFreq = 440 * Math.pow(1.059, Math.min(combo, 12)); 

    // Layered harmonic success sound
    [1, 1.2, 1.5, 2].forEach((mult, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(baseFreq * mult, time);
      
      // Slight pitch slide for "juice"
      osc.frequency.exponentialRampToValueAtTime(baseFreq * mult * 1.02, time + 0.1);
      
      g.gain.setValueAtTime(0.15 / (i + 1), time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.4 + (i * 0.1));
      
      osc.connect(g);
      g.connect(this.master!);
      osc.start();
      osc.stop(time + 0.6);
    });

    // Add a high "sparkle" for high combos
    if (combo > 5) {
      this.playSparkle(time);
    }
  }

  private playSparkle(time: number) {
    if (!this.ctx || !this.master) return;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(2000 + Math.random() * 1000, time + i * 0.05);
      g.gain.setValueAtTime(0.05, time + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, time + i * 0.05 + 0.1);
      osc.connect(g);
      g.connect(this.master);
      osc.start(time + i * 0.05);
      osc.stop(time + i * 0.05 + 0.1);
    }
  }

  playComboMilestone() {
    if (!this.ctx || !this.master) return;
    const time = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    
    notes.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time + i * 0.1);
      g.gain.setValueAtTime(0.1, time + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, time + i * 0.1 + 0.4);
      osc.connect(g);
      g.connect(this.master!);
      osc.start(time + i * 0.1);
      osc.stop(time + i * 0.1 + 0.5);
    });
  }

  playClick() {
    if (!this.ctx || !this.master) return;
    const time = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, time);
    osc.frequency.exponentialRampToValueAtTime(400, time + 0.05);
    g.gain.setValueAtTime(0.1, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(time + 0.05);
  }

  playFail() {
    if (!this.ctx || !this.master) return;
    const time = this.ctx.currentTime;
    
    // Low thud
    const osc1 = this.ctx.createOscillator();
    const g1 = this.ctx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(80, time);
    osc1.frequency.exponentialRampToValueAtTime(20, time + 0.5);
    g1.gain.setValueAtTime(0.3, time);
    g1.gain.linearRampToValueAtTime(0, time + 0.5);
    osc1.connect(g1);
    g1.connect(this.master);
    osc1.start();
    osc1.stop(time + 0.5);

    // Distorted buzz
    const osc2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(60, time);
    osc2.frequency.linearRampToValueAtTime(40, time + 0.3);
    g2.gain.setValueAtTime(0.1, time);
    g2.gain.linearRampToValueAtTime(0, time + 0.3);
    osc2.connect(g2);
    g2.connect(this.master);
    osc2.start();
    osc2.stop(time + 0.3);
  }

  playGameOver() {
    if (!this.ctx || !this.master) return;
    const time = this.ctx.currentTime;
    
    // Dramatic descending sweep
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 1.5);
    
    g.gain.setValueAtTime(0.2, time);
    g.gain.linearRampToValueAtTime(0.3, time + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, time + 1.5);
    
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(time + 1.5);
  }
}

export const audioEngine = new AudioEngine();
