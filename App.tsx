
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameStatus, GameState, Difficulty, GameStats } from './types';
import { audioEngine } from './services/AudioEngine';
import { 
  auth, 
  db, 
  signIn, 
  logOut, 
  UserProfile, 
  Tournament, 
  MatchLog, 
  Duel,
  OperationType,
  handleFirestoreError
} from './firebase';
import { 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  collection, 
  query, 
  where,
  orderBy, 
  limit, 
  addDoc, 
  serverTimestamp,
  updateDoc,
  increment,
  getDocs
} from 'firebase/firestore';

const BEST_SCORE_KEY = 'hold_game_best_score';
const STATS_KEY = 'hold_game_stats';
const ACHIEVED_MILESTONES_KEY = 'hold_game_achieved_milestones';

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
  const [state, setState] = useState<GameState>(() => {
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    } catch (e) {}
    return {
      status: GameStatus.INTRO,
      difficulty: Difficulty.MEDIUM,
      score: 0,
      best,
      combo: 0,
      radius: 0,
      safeMin: 100,
      safeMax: 150,
      speed: 3,
      isHolding: false,
      celebratingMilestone: null,
    };
  });

  const [feedback, setFeedback] = useState<FeedbackMessage[]>([]);
  const [isScorePopping, setIsScorePopping] = useState(false);
  const [isDistorted, setIsDistorted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [achievedMilestones, setAchievedMilestones] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(ACHIEVED_MILESTONES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [stats, setStats] = useState<GameStats>(() => {
    try {
      const saved = localStorage.getItem(STATS_KEY);
      return saved ? JSON.parse(saved) : INITIAL_STATS;
    } catch (e) {
      return INITIAL_STATS;
    }
  });

  // Firebase State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [globalLeaderboard, setGlobalLeaderboard] = useState<UserProfile[]>([]);
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  const [activeDuels, setActiveDuels] = useState<Duel[]>([]);
  const [gameLog, setGameLog] = useState<any[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(state);
  const requestRef = useRef<number>();
  const shakeRef = useRef(0);
  const flashRef = useRef(0);
  const nextFeedbackId = useRef(0);
  const particlesRef = useRef<Particle[]>([]);
  const nextParticleId = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data() as UserProfile);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('bestScore', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const users = snapshot.docs.map(d => d.data() as UserProfile);
      setGlobalLeaderboard(users);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'tournaments'), where('status', '==', 'active'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tournaments = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Tournament));
      setActiveTournaments(tournaments);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tournaments');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsInstalled(isStandalone);
    
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!isStandalone) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    
    const appInstalledHandler = () => {
      setIsInstalled(true);
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', appInstalledHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', appInstalledHandler);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ACHIEVED_MILESTONES_KEY, JSON.stringify(achievedMilestones));
    } catch (e) {}
  }, [achievedMilestones]);

  useEffect(() => {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {}
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

  const handleSignIn = async () => {
    try {
      audioEngine.playClick();
      await signIn();
    } catch (error: any) {
      console.error("Login failed:", error);
    }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const toggleMute = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    audioEngine.setMute(nextMute);
    audioEngine.playClick();
  };

  const handleHover = () => {
    audioEngine.playClick();
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

  const gameOver = useCallback(async () => {
    const s = stateRef.current;
    audioEngine.playFail();
    audioEngine.playGameOver();
    shakeRef.current = 50;
    setIsDistorted(true);
    setTimeout(() => setIsDistorted(false), 600);
    
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }

    setStats(prev => ({ 
      ...prev, 
      totalScore: prev.totalScore + s.score,
      highestCombo: Math.max(prev.highestCombo, s.combo)
    }));

    // Sync to Firestore
    if (user) {
      try {
        const matchData = {
          uid: user.uid,
          score: s.score,
          timestamp: serverTimestamp(),
          gameLog: JSON.stringify(gameLog),
          status: 'pending'
        };
        await addDoc(collection(db, 'matches'), matchData);
        
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          bestScore: Math.max(s.score, profile?.bestScore || 0),
          gamesPlayed: increment(1)
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'matches');
      }
    }

    setState(prev => ({ ...prev, status: GameStatus.GAMEOVER, isHolding: false }));
    setGameLog([]);
  }, [user, profile, gameLog]);

  const handleInput = useCallback((down: boolean) => {
    const s = stateRef.current;
    if (s.status !== GameStatus.PLAYING || s.celebratingMilestone !== null) return;

    if (down && !s.isHolding) {
      audioEngine.startDrone();
      setState(prev => ({ ...prev, isHolding: true }));
      setGameLog(prev => [...prev, { type: 'hold', time: Date.now(), radius: s.radius }]);
    } else if (!down && s.isHolding) {
      audioEngine.stopDrone();
      setStats(prev => ({ ...prev, totalAttempts: prev.totalAttempts + 1 }));
      setGameLog(prev => [...prev, { type: 'release', time: Date.now(), radius: s.radius }]);
      
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
        if (nextBest > s.best) {
          try {
            localStorage.setItem(BEST_SCORE_KEY, nextBest.toString());
          } catch (e) {}
        }

        // Milestone Check
        const milestones = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];
        const reachedMilestone = milestones.find(m => s.score < m && nextScore >= m);
        const isNewMilestone = reachedMilestone && !achievedMilestones.includes(reachedMilestone);
        
        setIsScorePopping(true);
        setTimeout(() => setIsScorePopping(false), 200);

        audioEngine.playSuccess(newCombo);
        
        if (isNewMilestone) {
          setAchievedMilestones(prev => [...prev, reachedMilestone]);
        }

        setState(prev => ({ 
          ...prev, 
          score: nextScore, 
          best: nextBest, 
          combo: newCombo,
          isHolding: false,
          celebratingMilestone: isNewMilestone ? reachedMilestone : null
        }));

        if (isNewMilestone) {
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

        gameOver();
      }
    }
  }, [newRound, gameOver]);

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
        <div className="flex gap-2 pointer-events-auto">
          <button 
            onClick={toggleMute}
            onMouseEnter={handleHover}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isMuted ? (
                <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/>
              ) : (
                <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
              )}
            </svg>
          </button>
          <button 
            onClick={togglePause}
            onMouseEnter={handleHover}
            className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
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
              onMouseEnter={handleHover}
              className="bg-white text-bg px-12 py-4 rounded-full font-black text-xs tracking-widest hover:scale-105 active:scale-95 transition-transform w-full"
            >
              CONTINUE
            </button>
          </div>
        </div>
      )}

      {state.status === GameStatus.INTRO && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col items-center justify-center p-10 text-center pointer-events-auto">
          {showInstallBanner && !isInstalled && (
            <div className="absolute top-0 left-0 w-full p-4 bg-accent/20 border-b border-accent/30 backdrop-blur-md flex items-center justify-between animate-in slide-in-from-top duration-500">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shadow-[0_0_15px_rgba(0,242,255,0.5)]">
                  <div className="w-4 h-4 border-2 border-bg rounded-full" />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold text-[10px] uppercase tracking-wider">Install HOLD.</p>
                  <p className="text-white/60 text-[8px] uppercase tracking-widest">Play offline & full screen</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowInstallBanner(false)}
                  className="px-3 py-2 rounded-lg text-white/40 text-[8px] font-bold uppercase tracking-widest hover:text-white"
                >
                  Later
                </button>
                <button 
                  onClick={handleInstall}
                  className="px-4 py-2 rounded-lg bg-white text-bg text-[8px] font-black uppercase tracking-widest shadow-lg"
                >
                  Install
                </button>
              </div>
            </div>
          )}

          <div className="w-20 h-20 border-4 border-accent rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(0,242,255,0.4)] mb-8 animate-pulse">
             <div className="w-8 h-8 border-4 border-accent rounded-full" />
          </div>
          <h1 className="font-display text-8xl font-light mb-2 tracking-tighter text-white">HOLD.</h1>
          <p className="font-display italic text-accent/60 text-lg mb-12 tracking-wide">Precision is the only currency.</p>
          
          {!user ? (
            <button 
              onClick={handleSignIn}
              onMouseEnter={handleHover}
              className="mb-12 group flex items-center gap-4 bg-white/5 border border-white/10 px-8 py-4 rounded-2xl hover:bg-white/10 transition-all"
            >
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div className="text-left">
                <p className="text-white font-bold text-xs uppercase tracking-widest">Connect Account</p>
                <p className="text-white/40 text-[10px] uppercase tracking-widest">Sign in to earn rewards</p>
              </div>
            </button>
          ) : (
            <div className="mb-12 flex items-center gap-4 bg-white/5 border border-white/10 px-6 py-3 rounded-2xl">
              <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border border-white/10" referrerPolicy="no-referrer" />
              <div className="text-left">
                <p className="text-white font-bold text-xs uppercase tracking-widest">{user.displayName}</p>
                <p className="text-success text-[10px] font-bold uppercase tracking-widest">${profile?.walletBalance.toFixed(2)} Available</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6 max-w-xs mb-12 text-left">
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

          <div className="flex gap-3 mb-12">
            {[Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD].map((d) => (
              <button
                key={d}
                onClick={() => {
                  audioEngine.playClick();
                  setState(prev => ({ ...prev, difficulty: d }));
                }}
                onMouseEnter={handleHover}
                className={`px-6 py-3 rounded-xl font-bold text-[10px] tracking-[0.3em] transition-all uppercase ${
                  state.difficulty === d 
                    ? 'bg-white text-bg scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)]' 
                    : 'bg-white/5 text-white/30 border border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <button 
            onClick={() => startGame(state.difficulty)}
            onMouseEnter={handleHover}
            className="group relative bg-white text-bg px-20 py-5 rounded-full font-black text-sm tracking-[0.4em] hover:scale-105 transition-all shadow-[0_20px_60px_rgba(255,255,255,0.15)] active:scale-95 overflow-hidden"
          >
            <div className="absolute inset-0 bg-accent/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10">START SESSION</span>
          </button>

          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <button 
              onClick={() => {
                audioEngine.playClick();
                setState(prev => ({ ...prev, status: GameStatus.LEADERBOARD }));
              }}
              onMouseEnter={handleHover}
              className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
              </svg>
              Leaderboard
            </button>
            <button 
              onClick={() => {
                audioEngine.playClick();
                setState(prev => ({ ...prev, status: GameStatus.TOURNAMENTS }));
              }}
              onMouseEnter={handleHover}
              className="px-6 py-3 rounded-xl bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest hover:bg-accent/20 transition-all flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Tournaments
            </button>
            <button 
              onClick={() => {
                audioEngine.playClick();
                setState(prev => ({ ...prev, status: GameStatus.WALLET }));
              }}
              onMouseEnter={handleHover}
              className="px-6 py-3 rounded-xl bg-success/10 border border-success/20 text-success text-[10px] font-bold uppercase tracking-widest hover:bg-success/20 transition-all flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M22 10h-6a2 2 0 0 0 0 4h6"/>
              </svg>
              Wallet
            </button>
          </div>

          {deferredPrompt && (
            <button 
              onClick={handleInstall}
              onMouseEnter={handleHover}
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
            onMouseEnter={handleHover}
            className="mt-4 text-white/40 text-[10px] uppercase tracking-[0.4em] font-bold hover:text-white transition-colors"
          >
            VIEW STATISTICS
          </button>

          <div className="mt-12 text-white/20 text-[10px] uppercase tracking-[0.4em] font-bold">
            Best Record: {state.best}
          </div>
        </div>
      )}

      {state.status === GameStatus.LEADERBOARD && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col p-12 animate-in fade-in slide-in-from-bottom-10 duration-700">
          <div className="flex items-center justify-between mb-16">
            <div>
              <h2 className="font-display text-6xl font-light tracking-tighter text-white">GLOBAL</h2>
              <p className="font-display italic text-accent/60 text-lg tracking-wide">The elite precisionists.</p>
            </div>
            <button 
              onClick={() => setState(prev => ({ ...prev, status: GameStatus.INTRO }))}
              className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-6 pr-4 custom-scrollbar">
            {globalLeaderboard.map((p, i) => (
              <div key={p.uid} className={`group flex items-center gap-6 p-6 rounded-[2rem] border transition-all duration-300 ${p.uid === user?.uid ? 'bg-accent/10 border-accent/30 shadow-[0_0_30px_rgba(0,242,255,0.1)]' : 'bg-white/5 border-white/5 hover:border-white/20'}`}>
                <div className="w-10 font-display italic text-white/20 text-3xl">{i + 1}</div>
                <div className="relative">
                  <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.uid}`} alt="" className="w-14 h-14 rounded-full bg-white/10 border border-white/10" referrerPolicy="no-referrer" />
                  {i < 3 && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-perfect flex items-center justify-center shadow-lg">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-lg tracking-tight text-white/90">{p.displayName}</p>
                  <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-bold">{p.gamesPlayed} SESSIONS</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-light text-4xl text-white">{p.bestScore}</p>
                  <p className="text-[9px] text-accent font-bold uppercase tracking-[0.4em]">POINTS</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.status === GameStatus.WALLET && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col p-12 animate-in fade-in slide-in-from-bottom-10 duration-700">
          <div className="flex items-center justify-between mb-16">
            <div>
              <h2 className="font-display text-6xl font-light tracking-tighter text-white">WALLET</h2>
              <p className="font-display italic text-accent/60 text-lg tracking-wide">Your precision, rewarded.</p>
            </div>
            <button 
              onClick={() => setState(prev => ({ ...prev, status: GameStatus.INTRO }))}
              className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {!user ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-24 h-24 bg-accent/5 rounded-full flex items-center justify-center mb-10 border border-accent/10 relative">
                <div className="absolute inset-0 rounded-full border border-accent/20 animate-ping opacity-20" />
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <h3 className="font-display text-4xl font-light mb-6 tracking-tight">SECURE ACCESS</h3>
              <p className="text-white/40 font-display italic text-lg mb-12 max-w-xs leading-relaxed">Connect your identity to unlock the full potential of your precision.</p>
              <button 
                onClick={handleSignIn}
                className="group relative bg-white text-bg px-16 py-5 rounded-full font-black text-xs tracking-[0.3em] hover:scale-105 active:scale-95 transition-all shadow-[0_20px_60px_rgba(255,255,255,0.1)] overflow-hidden"
              >
                <div className="absolute inset-0 bg-accent/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10">SIGN IN WITH GOOGLE</span>
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="bg-white/5 border border-white/5 p-12 rounded-[3rem] mb-10 text-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="absolute top-0 right-0 p-8">
                  <div className="px-4 py-1.5 rounded-full bg-success/10 border border-success/20 text-success text-[9px] font-black uppercase tracking-[0.2em]">Verified Account</div>
                </div>
                <p className="text-white/30 text-[11px] font-bold uppercase tracking-[0.5em] mb-4">Available Balance</p>
                <h3 className="font-display text-8xl font-light text-white tracking-tighter mb-4">${profile?.walletBalance.toFixed(2)}</h3>
                <div className="flex items-center justify-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <p className="text-success/80 font-display italic text-xl">Total Earned: ${profile?.totalEarnings.toFixed(2)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-10">
                <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] text-center hover:bg-white/10 transition-colors group">
                  <p className="text-white/30 text-[9px] font-bold uppercase tracking-[0.4em] mb-2 group-hover:text-white/50 transition-colors">Sessions</p>
                  <p className="font-display font-light text-4xl text-white">{profile?.gamesPlayed}</p>
                </div>
                <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] text-center hover:bg-white/10 transition-colors group">
                  <p className="text-white/30 text-[9px] font-bold uppercase tracking-[0.4em] mb-2 group-hover:text-white/50 transition-colors">Peak Score</p>
                  <p className="font-display font-light text-4xl text-white">{profile?.bestScore}</p>
                </div>
              </div>

              <button 
                disabled={!profile || profile.walletBalance < 5}
                className="group relative w-full bg-white text-bg py-6 rounded-full font-black text-xs tracking-[0.4em] disabled:opacity-10 disabled:grayscale mb-6 overflow-hidden transition-all hover:scale-[1.02] active:scale-95"
              >
                <div className="absolute inset-0 bg-success/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10">WITHDRAW FUNDS</span>
              </button>
              <p className="text-center text-white/20 text-[9px] uppercase tracking-[0.5em] font-bold">Minimum withdrawal: $5.00</p>
              
              <div className="mt-auto pt-10 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <img src={user.photoURL || ''} alt="" className="w-14 h-14 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                  <div>
                    <p className="font-bold text-sm text-white/90">{user.displayName}</p>
                    <button onClick={logOut} className="text-danger/60 text-[9px] font-bold uppercase tracking-[0.3em] hover:text-danger transition-colors">Terminate Session</button>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white/20 text-[8px] uppercase tracking-[0.3em] font-bold mb-1">Status</p>
                  <p className="text-success text-[10px] font-bold uppercase tracking-[0.2em]">Online</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {state.status === GameStatus.TOURNAMENTS && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col p-12 animate-in fade-in slide-in-from-bottom-10 duration-700">
          <div className="flex items-center justify-between mb-16">
            <div>
              <h2 className="font-display text-6xl font-light tracking-tighter text-white">EVENTS</h2>
              <p className="font-display italic text-accent/60 text-lg tracking-wide">High stakes precision.</p>
            </div>
            <button 
              onClick={() => setState(prev => ({ ...prev, status: GameStatus.INTRO }))}
              className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto pr-4 custom-scrollbar">
            {activeTournaments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-96 text-center">
                <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-10 border border-white/10 opacity-20">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/>
                  </svg>
                </div>
                <p className="font-display italic text-white/30 text-2xl tracking-wide">The arena is currently silent.</p>
                <p className="text-[10px] mt-4 text-white/20 uppercase tracking-[0.5em] font-bold">Check back soon for the next event.</p>
              </div>
            ) : (
              activeTournaments.map(t => (
                <div key={t.id} className="bg-white/5 border border-white/5 p-12 rounded-[3rem] relative overflow-hidden group hover:bg-white/10 transition-all duration-500">
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-perfect/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  <div className="absolute top-0 right-0 p-10">
                    <div className="px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[9px] font-black uppercase tracking-[0.3em] animate-pulse">Live Event</div>
                  </div>
                  <h3 className="font-display text-4xl font-light mb-4 tracking-tight text-white group-hover:translate-x-2 transition-transform duration-500">{t.title}</h3>
                  <div className="flex items-center gap-10 mb-12">
                    <div>
                      <p className="text-white/30 text-[10px] font-bold uppercase tracking-[0.4em] mb-2">Prize Pool</p>
                      <p className="font-display font-light text-5xl text-perfect">${t.prizePool}</p>
                    </div>
                    <div className="w-px h-12 bg-white/10" />
                    <div>
                      <p className="text-white/30 text-[10px] font-bold uppercase tracking-[0.4em] mb-2">Entry Fee</p>
                      <p className="font-display font-light text-5xl text-white">{t.entryFee === 0 ? 'FREE' : `$${t.entryFee}`}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => startGame(state.difficulty)}
                    className="group relative w-full bg-white text-bg py-6 rounded-full font-black text-xs tracking-[0.4em] hover:scale-[1.02] active:scale-95 transition-all overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-accent/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    <span className="relative z-10">ENTER THE ARENA</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {state.status === GameStatus.STATS && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col p-12 animate-in fade-in slide-in-from-bottom-10 duration-700">
          <div className="flex items-center justify-between mb-16">
            <div>
              <h2 className="font-display text-6xl font-light tracking-tighter text-white">STATISTICS</h2>
              <p className="font-display italic text-accent/60 text-lg tracking-wide">Your journey in numbers.</p>
            </div>
            <button 
              onClick={() => setState(prev => ({ ...prev, status: GameStatus.INTRO }))}
              className="w-12 h-12 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-2xl mx-auto mb-16">
            <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] group hover:bg-white/10 transition-all">
              <span className="text-white/30 text-[10px] uppercase tracking-[0.4em] font-bold mb-2 block">Total Playtime</span>
              <span className="text-white font-display text-5xl font-light">
                {Math.floor(stats.totalPlaytime / 60)}<span className="text-xl text-white/40 ml-1">m</span> {stats.totalPlaytime % 60}<span className="text-xl text-white/40 ml-1">s</span>
              </span>
            </div>
            <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] group hover:bg-white/10 transition-all">
              <span className="text-white/30 text-[10px] uppercase tracking-[0.4em] font-bold mb-2 block">Average Precision</span>
              <span className="text-white font-display text-5xl font-light">
                {stats.totalGames > 0 ? Math.floor(stats.totalScore / stats.totalGames) : 0}
              </span>
            </div>
            <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] group hover:bg-white/10 transition-all">
              <span className="text-white/30 text-[10px] uppercase tracking-[0.4em] font-bold mb-2 block">Peak Combo</span>
              <span className="text-white font-display text-5xl font-light text-danger">{stats.highestCombo}</span>
            </div>
            <div className="bg-white/5 border border-white/5 p-8 rounded-[2rem] group hover:bg-white/10 transition-all">
              <span className="text-white/30 text-[10px] uppercase tracking-[0.4em] font-bold mb-2 block">Accuracy Rating</span>
              <span className="text-white font-display text-5xl font-light text-success">
                {stats.totalAttempts > 0 ? Math.floor((stats.successfulAttempts / stats.totalAttempts) * 100) : 0}<span className="text-xl text-white/40 ml-1">%</span>
              </span>
            </div>
          </div>

          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.INTRO }));
            }}
            onMouseEnter={handleHover}
            className="group relative bg-white text-bg px-16 py-6 rounded-full font-black text-xs tracking-[0.4em] w-full max-w-xs mx-auto active:scale-95 transition-all overflow-hidden"
          >
            <div className="absolute inset-0 bg-accent/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10">RETURN TO MENU</span>
          </button>
        </div>
      )}

      {state.status === GameStatus.PAUSED && (
        <div className="absolute inset-0 z-40 bg-bg/90 backdrop-blur-xl flex flex-col items-center justify-center p-10 pointer-events-auto">
          <h2 className="font-display text-5xl font-black mb-12 tracking-tight">PAUSED</h2>
          <button 
            onClick={() => togglePause()}
            onMouseEnter={handleHover}
            className="bg-white text-bg px-14 py-5 rounded-full font-black text-xs tracking-widest mb-4 w-full max-w-xs active:scale-95 transition-transform"
          >
            CONTINUE
          </button>
          <button 
            onClick={() => {
              audioEngine.playClick();
              setState(prev => ({ ...prev, status: GameStatus.INTRO }));
            }}
            onMouseEnter={handleHover}
            className="border-2 border-white/10 text-white/60 px-14 py-5 rounded-full font-black text-xs tracking-widest w-full max-w-xs hover:bg-white/5 transition-colors"
          >
            EXIT TO MENU
          </button>
        </div>
      )}

      {state.status === GameStatus.GAMEOVER && (
        <div className="absolute inset-0 z-50 bg-bg flex flex-col items-center justify-center p-12 pointer-events-auto animate-heavy-shake">
          <div className="relative mb-8">
            <h2 className="font-display text-9xl font-light text-danger tracking-tighter animate-glitch">LOST.</h2>
            <h2 className="absolute inset-0 font-display text-9xl font-light text-accent tracking-tighter opacity-20 animate-glitch" style={{ animationDelay: '0.1s' }}>LOST.</h2>
          </div>
          
          <div className="bg-white/5 border border-white/5 p-10 rounded-[3rem] text-center mb-12 w-full max-w-sm relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-danger to-transparent" />
            <p className="text-white/30 text-[10px] font-bold uppercase tracking-[0.5em] mb-4">Final Score</p>
            <h3 className="font-display text-7xl font-light text-white tracking-tighter mb-2">{state.score}</h3>
            <p className="font-display italic text-white/40 text-lg">Precision failed at the peak.</p>
          </div>
          
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <button 
              onClick={() => startGame(state.difficulty)}
              onMouseEnter={handleHover}
              className="group relative bg-white text-bg px-16 py-6 rounded-full font-black text-xs tracking-[0.4em] hover:scale-[1.02] active:scale-95 transition-all shadow-[0_20px_60px_rgba(255,45,85,0.15)] overflow-hidden"
            >
              <div className="absolute inset-0 bg-danger/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <span className="relative z-10">TRY AGAIN</span>
            </button>
            <button 
              onClick={() => {
                audioEngine.playClick();
                setState(prev => ({ ...prev, status: GameStatus.INTRO }));
              }}
              onMouseEnter={handleHover}
              className="px-16 py-6 rounded-full border border-white/10 text-white/40 font-black text-xs tracking-[0.4em] hover:bg-white/5 hover:text-white transition-all"
            >
              MAIN MENU
            </button>
          </div>
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
