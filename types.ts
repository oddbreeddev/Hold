
export enum GameStatus {
  INTRO = 'INTRO',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAMEOVER = 'GAMEOVER',
  STATS = 'STATS'
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD'
}

export interface GameStats {
  totalPlaytime: number; // in seconds
  totalGames: number;
  totalScore: number;
  highestCombo: number;
  totalAttempts: number;
  successfulAttempts: number;
}

export interface GameState {
  status: GameStatus;
  difficulty: Difficulty;
  score: number;
  best: number;
  combo: number;
  radius: number;
  safeMin: number;
  safeMax: number;
  speed: number;
  isHolding: boolean;
  celebratingMilestone: number | null;
}
