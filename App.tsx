
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameStatus, GameState, Difficulty, GameStats } from './types';
import { audioEngine } from './services/AudioEngine';

const BEST_SCORE_KEY = 'hold_game_best_score';
const STATS_KEY = 'hold_game_stats';

const INITIAL_STATS: GameStats = {
  totalPlaytime: 0,
  totalGames: 0,
  totalScore: 0,
  highestCombo: 0,
  totalAttempts: 0,
  successfulAttempts: 0,
};

interface FeedbackMessage {
  id: number;
  text: string;
  color: string;
  isSpecial?: boolean;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

const App: React.FC = () => {
  const [state, setState] = useState<GameState>({
    status: GameStatus.INTRO,
    difficulty: Difficulty.MEDIUM,
    score: 0,
    best: Number(localStorage.getItem(BEST_SCORE_KEY)) || 0,
    combo: 0,
    radius: 0,
    safeMin: 100,
    safeMax: 150,
    speed: 3,
    isHolding: false,
    celebratingMilestone: null,
  });

  const [feedback, setFeedback] = useState<FeedbackMessage[]>([]);
  const [isScorePopping, setIsScorePopping] = useState(false);
  const [isDistorted, setIsDistorted] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [stats, setStats] = useState<GameStats>(() => {
    const saved = localStorage.getItem(STATS_KEY);
    return saved ? JSON.parse(saved) : INITIAL_STATS;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(state);
  const requestRef = useRef<number>();
  const shakeRef = useRef(0);
  const flashRef = useRef(0);
  const nextFeedbackId = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const nextParticleId = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    let interval: any;
    if (state.status === GameStatus.PLAYING) {
      interval = setInterval(() => {
        setStats(prev => ({ ...prev, totalPlaytime: prev.totalPlaytime + 1 }));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state.status]);

  const triggerFeedback = (text: string, color: string, isSpecial = false) => {
    const id = nextFeedbackId.current++;
    setFeedback(prev => [...prev, { id, text, color, isSpecial }]);
    setTimeout(() => {
      setFeedback(prev => prev.filter(f => f.id !== id));
    }, 1200);
  };

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 8;
      particlesRef.current.push({
        id: nextParticleId.current++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: 2 + Math.random() * 4
      });
    }
  };

  const newRound = useCallback((currentScore: number, difficulty: Difficulty) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const baseSize = Math.min(w, h);
    
    const diff = Math.min(currentScore / 2500, 1);
    
    let baseZone = 70;
    let baseSpeed = 3.5;
    
    if (difficulty === Difficulty.EASY) {
      baseZone = 90;
      baseSpeed = 2.5;
    } else if (difficulty === Difficulty.HARD) {
      baseZone = 50;
      baseSpeed = 5.0;
    }

    const zoneThickness = baseZone - (diff * (baseZone * 0.6));
    const speed = baseSpeed + (diff * (baseSpeed * 2));
    
    const safeMin = (baseSize * 0.15) + Math.random() * (baseSize * 0.28);
    const safeMax = safeMin + zoneThickness;

    setState(prev => ({
      ...prev,
      radius: 0,
      safeMin,
      safeMax,
      speed,
      isHolding: false
    }));
  }, []);

  const startGame = (difficulty: Difficulty) => {
    audioEngine.init();
    audioEngine.playClick();
    newRound(0, difficulty);
    setStats(prev => ({ ...prev, totalGames: prev.totalGames + 1 }));
    setState(prev => ({ ...prev, status: GameStatus.PLAYING, difficulty, score: 0, combo: 0, celebratingMilestone: null }));
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const togglePause = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    audioEngine.playClick();
    if (state.status === GameStatus.PLAYING) {
      audioEngine.stopDrone();
      setState(prev => ({ ...prev, status: GameStatus.PAUSED, isHolding: false }));
    } else if (state.status === GameStatus.PAUSED) {
      setState(prev => ({ ...prev, status: GameStatus.PLAYING }));
    }
  };

  const handleInput = useCallback((down: boolean) => {
    const s = stateRef.current;
    if (s.status !== GameStatus.PLAYING || s.celebratingMilestone !== null) return;

    if (down && !s.isHolding) {
      audioEngine.startDrone();
      setState(prev => ({ ...prev, isHolding: true }));
    } else if (!down && s.isHolding) {
      audioEngine.stopDrone();
      setStats(prev => ({ ...prev, totalAttempts: prev.totalAttempts + 1 }));
      
      const inZone = s.radius >= s.safeMin && s.radius <= s.safeMax;
      
      if (inZone) {
        setStats(prev => ({ ...prev, successfulAttempts: prev.successfulAttempts + 1 }));
        const targetCenter = (s.safeMin + s.safeMax) / 2;
        const distFromCenter = Math.abs(s.radius - targetCenter);
        const maxDist = (s.safeMax - s.safeMin) / 2;
        const precision = 1 - (distFromCenter / maxDist);
        
        let msg = "NICE.";
        let color = "text-white";
        
        if (precision > 0.92) {
          msg = "PERFECT!";
          color = "text-perfect";
          shakeRef.current = 35;
          flashRef.current = 0.6;
          setIsDistorted(true);
          setTimeout(() => setIsDistorted(false), 400);
          if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
          spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#ffea00', 40);
        } else if (precision > 0.75) {
          msg = "GREAT!";
          color = "text-accent";
          shakeRef.current = 15;
          if (navigator.vibrate) navigator.vibrate(30);
        } else {
          if (navigator.vibrate) navigator.vibrate(15);
        }

        triggerFeedback(msg, color);

        const isPerfect = precision > 0.9;
        const newCombo = isPerfect ? s.combo + 1 : 0;
        
        let multiplier = 1.0;
        if (s.difficulty === Difficulty.EASY) multiplier = 0.7;
        if (s.difficulty === Difficulty.HARD) multiplier = 1.5;

        const points = Math.floor((s.radius / 8) * (1 + newCombo * 0.5) * multiplier);
        
        if (newCombo > 0 && newCombo % 5 === 0) {
          triggerFeedback(`${newCombo} HITS!`, "text-success", true);
          audioEngine.playComboMilestone();
        }

        const nextScore = s.score + points;
        const nextBest = Math.max(nextScore, s.best);
        if (nextBest > s.best) localStorage.setItem(BEST_SCORE_KEY, nextBest.toString());

        // Milestone Check
        const milestones = [100, 500, 1000, 2500, 5000, 10000];
        const reachedMilestone = milestones.find(m => s.score < m && nextScore >= m);
        
        setIsScorePopping(true);
        setTimeout(() => setIsScorePopping(false), 200);

        audioEngine.playSuccess(newCombo);
        setState(prev => ({ 
          ...prev, 
          score: nextScore, 
          best: nextBest, 
          combo: newCombo,
          isHolding: false,
          celebratingMilestone: reachedMilestone || null
        }));

        if (reachedMilestone) {
          audioEngine.playComboMilestone();
          spawnParticles(window.innerWidth / 2, window.innerHeight / 2, '#ffea00', 60);
        } else {
          newRound(nextScore, s.difficulty);
        }
      } else {
        const distFromMin = Math.abs(s.radius - s.safeMin);
        const distFromMax = Math.abs(s.radius - s.safeMax);
        const isNearMiss = distFromMin < 15 || distFromMax < 15;

        if (isNearMiss && navigator.vibrate) {
          navigator.vibrate([10, 50, 10]);
        } else if (navigator.vibrate) {
          navigator.vibrate(100);
        }

        audioEngine.playFail();
        audioEngine.playGameOver();
        shakeRef.current = 50;
        setStats(prev => ({ 
          ...prev, 
          totalScore: prev.totalScore + s.score,
          highestCombo: Math.max(prev.highestCombo, s.combo)
        }));
        setState(prev => ({ ...prev, status: GameStatus.GAMEOVER, isHolding: false }));
      }
    }
  }, [newRound]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    let offX = 0, offY = 0;
    if (shakeRef.current > 0) {
      offX = (Math.random() - 0.5) * shakeRef.current;
      offY = (Math.random() - 0.5) * shakeRef.current;
      shakeRef.current *= 0.9;
      if (shakeRef.current < 0.1) shakeRef.current = 0;
    }

    ctx.fillStyle = '#08080c';
    ctx.fillRect(0, 0, w, h);

    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(255, 234, 0, ${flashRef.current})`;
      ctx.fillRect(0, 0, w, h);
      flashRef.current *= 0.9;
      if (flashRef.current < 0.01) flashRef.current = 0;
    }

    if (s.status === GameStatus.PLAYING || s.status === GameStatus.PAUSED || s.status === GameStatus.GAMEOVER) {
      const inZone = s.radius >= s.safeMin && s.radius <= s.safeMax;
      const pulse = Math.sin(Date.now() / 150) * 0.5 + 0.5;

      ctx.beginPath();
      ctx.arc(cx + offX, cy + offY, (s.safeMin + s.safeMax) / 2, 0, Math.PI * 2);
      let zoneOpacity = s.isHolding ? 0.15 : 0.05;
      if (inZone && s.isHolding) zoneOpacity += 0.12 * pulse;
      
      ctx.strokeStyle = inZone && s.isHolding ? `rgba(0, 255, 170, ${zoneOpacity})` : `rgba(255, 255, 255, ${zoneOpacity})`;
      ctx.lineWidth = (s.safeMax - s.safeMin) * (inZone && s.isHolding ? 1.05 : 1);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + offX, cy + offY, s.radius, 0, Math.PI * 2);
      ctx.lineWidth = inZone && s.isHolding ? 8 : 6;
      
      const overshot = s.radius > s.safeMax;

      if (s.isHolding) {
        if (overshot) ctx.strokeStyle = '#ff2d55';
        else if (inZone) ctx.strokeStyle = '#00ffaa';
        else ctx.strokeStyle = '#ffffff';
        
        // Glow effect
        ctx.shadowBlur = inZone ? 15 : 0;
        ctx.shadowColor = inZone ? '#00ffaa' : 'transparent';
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Center Growth Indicator
      if (s.isHolding && s.status === GameStatus.PLAYING) {
        ctx.beginPath();
        ctx.arc(cx + offX, cy + offY, s.radius * 0.15, 0, Math.PI * 2);
        ctx.strokeStyle = inZone ? 'rgba(0, 255, 170, 0.4)' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Inner pulsing core
        ctx.beginPath();
        ctx.arc(cx + offX, cy + offY, 5 + (pulse * 5), 0, Math.PI * 2);
        ctx.fillStyle = inZone ? 'rgba(0, 255, 170, 0.5)' : 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
      }

      // Draw Particles
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 0.02;
        
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      if (s.status === GameStatus.PLAYING && s.isHolding && s.celebratingMilestone === null) {
        const nextRadius = s.radius + s.speed;
        audioEngine.updateGameState(nextRadius, inZone, s.speed);
        
        if (nextRadius > Math.min(w, h) * 0.95) {
          audioEngine.stopDrone();
          audioEngine.playFail();
          audioEngine.playGameOver();
          shakeRef.current = 50;
          if (navigator.vibrate) navigator.vibrate(100);
          setStats(prev => ({ 
            ...prev, 
            totalScore: prev.totalScore + s.score,
            highestCombo: Math.max(prev.highestCombo, s.combo)
          }));
          setState(prev => ({ ...prev, status: GameStatus.GAMEOVER, isHolding: false }));
        } else {
          setState(prev => ({ ...prev, radius: nextRadius }));
        }
      }
    }

    requestRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [draw]);

  return (
    <div 
      className={`relative w-full h-screen bg-bg overflow-hidden flex flex-col font-sans select-none transition-all duration-300 ${isDistorted ? 'filter contrast-150 brightness-125 saturate-200' : ''}`}
      onPointerDown={() => handleInput(true)}
      onPointerUp={() => handleInput(false)}
      onPointerLeave={() => handleInput(false)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />

      {/* Feedback Messages Overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
        {feedback.map(f => (
          <div 
            key={f.id} 
            className={`absolute font-display font-black tracking-tighter pointer-events-none ${f.isSpecial ? 'text-6xl animate-streak' : 'text-3xl animate-float-up'} ${f.color}`}
            style={{ textShadow: '0 0 20px currentColor' }}
          >
            {f.text}
          </div>
        ))}
      </div>

      <div className="relative z-30 flex justify-between items-start p-8 pointer-events-none">
        <div className={`transition-all duration-500 ${state.combo > 0 ? 'animate-pulse-streak' : ''}`}>
          <div className={`font-display text-6xl font-black leading-none transition-all ${isScorePopping ? 'animate-score-pop' : ''} ${state.combo > 10 ? 'text-perfect' : state.combo > 5 ? 'text-danger' : 'text-white'}`}>
            {state.score}
          </div>
          <div className={`font-display text-xs mt-2 tracking-[0.3em] font-bold transition-all duration-300 ${state.combo > 0 ? 'opacity-100' : 'opacity-0'} ${state.combo > 5 ? 'text-danger' : 'text-accent'}`}>
            COMBO X{state.combo}
          </div>
        </div>
        <button 
          onClick={togglePause}
          className="pointer-events-auto w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
          disabled={state.celebratingMilestone !== null}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            {state.status === GameStatus.PAUSED ? (
              <path d="M8 5v14l11-7z"/>
            ) : (
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            )}
          </svg>
        </button>
      </div>

      {state.celebratingMilestone !== null && (
        <div className="absolute inset-0 z-[100] bg-bg/80 backdrop-blur-md flex items-center justify-center p-8 pointer-events-auto animate-in fade-in zoom-in duration-300">
          <div className="bg-white/5 border border-white/10 p-12 rounded-[3rem] text-center max-w-sm w-full shadow-[0_0_100px_rgba(255,234,0,0.1)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-perfect to-transparent" />
            
            <div className="w-20 h-20 bg-perfect/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-perfect/20">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                <path d="M4 22h16"/>
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
              </svg>
            </div>
            
            <h3 className="font-display text-xs tracking-[0.4em] uppercase font-black text-perfect mb-2">Milestone Reached</h3>
            <h2 className="font-display text-6xl font-black text-white mb-6 tracking-tighter">{state.celebratingMilestone}</h2>
            <p className="text-white/40 text-sm leading-relaxed mb-10">You've reached a new peak of precision. Keep holding on.</p>
            
            <button 
              onClick={() => {
                audioEngine.playClick();
                setState(prev => ({ ...prev, celebratingMilestone: null }));
                newRound(state.score, state.difficulty);
              }}
              className="bg-white text-bg px-12 py-4 rounded-full font-black text-xs tracking-widest hover:scale-105 active:scale-95 transition-transform w-full"
            >
              CONTINUE
            </button>
          </div>
        </div>
      )}

      {state.status === GameStatus.INTRO && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col items-center justify-center p-10 text-center pointer-events-auto">
          <div className="w-20 h-20 border-4 border-accent rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(0,242,255,0.4)] mb-8 animate-pulse">
             <div className="w-8 h-8 border-4 border-accent rounded-full" />
          </div>
          <h1 className="font-display text-7xl font-black mb-8 tracking-tighter">HOLD.</h1>
          
          <div className="flex flex-col gap-5 max-w-xs mb-10 text-left">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex-shrink-0 flex items-center justify-center text-accent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm tracking-tight uppercase">Hold to Grow</p>
                <p className="text-white/40 text-[11px] leading-tight mt-0.5">Press anywhere to expand the ring.</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/20 flex-shrink-0 flex items-center justify-center text-success">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm tracking-tight uppercase">Release to Score</p>
                <p className="text-white/40 text-[11px] leading-tight mt-0.5">Let go inside the target zone.</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-perfect/10 border border-perfect/20 flex-shrink-0 flex items-center justify-center text-perfect">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm tracking-tight uppercase">Precision First</p>
                <p className="text-white/40 text-[11px] leading-tight mt-0.5">Hit the center for perfect combos.</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-8">
            {[Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD].map((d) => (
              <button
                key={d}
                onClick={() => {
                  audioEngine.playClick();
                  setState(prev => ({ ...prev, difficulty: d }));
                }}
                className={`px-4 py-2 rounded-lg font-bold text-[10px] tracking-widest transition-all ${
                  state.difficulty === d 
                    ? 'bg-white text-bg scale-105 shadow-lg' 
                    : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <button 
            onClick={() => startGame(state.difficulty)}
            className="bg-white text-bg px-16 py-4 rounded-full font-black text-sm tracking-[0.2em] hover:scale-110 transition-transform shadow-[0_15px_40_rgba(255,255,255,0.2)] active:scale-95"
          >
            PLAY
          </button>

          {deferredPrompt && (
            <button 
              onClick={handleInstall}
              className="mt-6 flex items-center gap-2 text-accent/60 hover:text-accent transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center group-hover:bg-accent/20">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Install App</span>
            </button>
          )}
          
          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.STATS }));
            }}
            className="mt-4 text-white/40 text-[10px] uppercase tracking-[0.4em] font-bold hover:text-white transition-colors"
          >
            VIEW STATISTICS
          </button>

          <div className="mt-12 text-white/20 text-[10px] uppercase tracking-[0.4em] font-bold">
            Best Record: {state.best}
          </div>
        </div>
      )}

      {state.status === GameStatus.STATS && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col items-center justify-center p-10 pointer-events-auto">
          <h2 className="font-display text-5xl font-black mb-12 tracking-tight">STATISTICS</h2>
          
          <div className="grid grid-cols-2 gap-8 w-full max-w-md mb-16">
            <div className="flex flex-col">
              <span className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-1">Playtime</span>
              <span className="text-white font-display text-2xl font-black">
                {Math.floor(stats.totalPlaytime / 60)}m {stats.totalPlaytime % 60}s
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-1">Avg Score</span>
              <span className="text-white font-display text-2xl font-black">
                {stats.totalGames > 0 ? Math.floor(stats.totalScore / stats.totalGames) : 0}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-1">Max Combo</span>
              <span className="text-white font-display text-2xl font-black text-danger">{stats.highestCombo}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-1">Accuracy</span>
              <span className="text-white font-display text-2xl font-black text-success">
                {stats.totalAttempts > 0 ? Math.floor((stats.successfulAttempts / stats.totalAttempts) * 100) : 0}%
              </span>
            </div>
          </div>

          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.INTRO }));
            }}
            className="bg-white text-bg px-14 py-5 rounded-full font-black text-xs tracking-widest w-full max-w-xs active:scale-95 transition-transform"
          >
            BACK TO MENU
          </button>
        </div>
      )}

      {state.status === GameStatus.PAUSED && (
        <div className="absolute inset-0 z-40 bg-bg/90 backdrop-blur-xl flex flex-col items-center justify-center p-10 pointer-events-auto">
          <h2 className="font-display text-5xl font-black mb-12 tracking-tight">PAUSED</h2>
          <button 
            onClick={() => togglePause()}
            className="bg-white text-bg px-14 py-5 rounded-full font-black text-xs tracking-widest mb-4 w-full max-w-xs active:scale-95 transition-transform"
          >
            CONTINUE
          </button>
          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.INTRO }));
            }}
            className="border-2 border-white/10 text-white/60 px-14 py-5 rounded-full font-black text-xs tracking-widest w-full max-w-xs hover:bg-white/5 transition-colors"
          >
            EXIT TO MENU
          </button>
        </div>
      )}

      {state.status === GameStatus.GAMEOVER && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col items-center justify-center p-10 pointer-events-auto animate-heavy-shake">
          <div className="relative">
            <h2 className="font-display text-7xl font-black text-danger mb-4 tracking-tighter animate-glitch">LOST.</h2>
            <h2 className="absolute inset-0 font-display text-7xl font-black text-accent mb-4 tracking-tighter opacity-30 animate-glitch" style={{ animationDelay: '0.1s' }}>LOST.</h2>
          </div>
          <div className="text-white/30 mb-12 tracking-[0.4em] uppercase font-bold text-xs">Total Score: {state.score}</div>
          
          <button 
            onClick={() => startGame(state.difficulty)}
            className="bg-white text-bg px-16 py-5 rounded-full font-black text-xs tracking-[0.2em] mb-4 w-full max-w-xs hover:scale-105 active:scale-95 transition-transform shadow-[0_20px_50px_rgba(255,45,85,0.2)]"
          >
            TRY AGAIN
          </button>
          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.INTRO }));
            }}
            className="border-2 border-white/5 text-white/40 px-16 py-5 rounded-full font-black text-xs tracking-[0.2em] w-full max-w-xs hover:bg-white/5 transition-colors"
          >
            MAIN MENU
          </button>
        </div>
      )}

      {state.status === GameStatus.PLAYING && !state.isHolding && (
        <div className="absolute bottom-16 w-full flex justify-center pointer-events-none opacity-40">
          <div className="text-white text-[9px] tracking-[0.8em] uppercase font-bold">Tap and Hold</div>
        </div>
      )}

      {state.isHolding && state.status === GameStatus.PLAYING && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className={`transition-all duration-200 transform ${state.radius >= state.safeMin && state.radius <= state.safeMax ? 'scale-110 opacity-100' : 'scale-90 opacity-30'}`}>
            <div className={`font-display text-5xl font-black ${state.radius >= state.safeMin && state.radius <= state.safeMax ? 'text-success' : 'text-white'}`}>
              +{Math.floor((state.radius / 8) * (1 + state.combo * 0.5) * (state.difficulty === Difficulty.EASY ? 0.7 : state.difficulty === Difficulty.HARD ? 1.5 : 1.0))}
            </div>
            <div className="text-center text-[10px] tracking-[0.4em] uppercase font-bold opacity-50 mt-2">Potential</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
