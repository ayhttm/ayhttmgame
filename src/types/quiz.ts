export type GamePhase =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'QUESTION'
  | 'REVEAL'
  | 'LEADERBOARD'
  | 'FINAL_PODIUM';

export type AvatarColor =
  | 'indigo'
  | 'rose'
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'violet';

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  timeLimitSec?: number;
  explanation?: string;
  imageUrl?: string;
}

export interface QuizDeck {
  id: string;
  title: string;
  category: string;
  description: string;
  defaultTimeLimitSec: number;
  questions: QuizQuestion[];
  isCustom?: boolean;
}

export interface RoomSettings {
  hostPlays: boolean;
  autoAdvance: boolean;
}

export interface PlayerSnapshot {
  clientId: string;
  name: string;
  color: AvatarColor;
  isHost: boolean;
  isPlaying: boolean;
  connected: boolean;
  score: number;
  lastRoundScore: number;
  streak: number;
  correctCount: number;
  answeredCurrent: boolean;
  selectedOption: number | null;
}

export interface SanitizedQuestion {
  id: string;
  prompt: string;
  options: string[];
  timeLimitSec: number;
  imageUrl?: string;
  correctIndex?: number;
  explanation?: string;
}

export interface RoomSnapshot {
  roomCode: string;
  phase: GamePhase;
  quizId?: string;
  quizTitle: string;
  quizCategory: string;
  totalQuestions: number;
  currentQuestionIndex: number;
  phaseStartedAt: number;
  phaseDurationMs: number;
  serverNow: number;
  settings: RoomSettings;
  players: PlayerSnapshot[];
  currentQuestion: SanitizedQuestion | null;
  optionCounts: number[] | null;
  activePlayerCount: number;
  answeredCount: number;
}

export interface ReactionBurst {
  id: string;
  senderName: string;
  label: string;
  createdAt: number;
}

export type ClientMessage =
  | {
      type: 'room:create';
      clientId: string;
      playerName: string;
      color: AvatarColor;
      quiz: QuizDeck;
      settings?: Partial<RoomSettings>;
    }
  | {
      type: 'room:join';
      clientId: string;
      roomCode: string;
      playerName: string;
      color: AvatarColor;
    }
  | {
      type: 'room:reconnect';
      clientId: string;
      roomCode: string;
    }
  | {
      type: 'room:leave';
    }
  | {
      type: 'host:update_settings';
      settings: Partial<RoomSettings>;
    }
  | {
      type: 'host:change_quiz';
      quiz: QuizDeck;
    }
  | {
      type: 'host:start_game';
    }
  | {
      type: 'player:submit_answer';
      optionIndex: number;
    }
  | {
      type: 'host:end_question';
    }
  | {
      type: 'host:next_step';
    }
  | {
      type: 'host:restart_game';
      quiz?: QuizDeck;
    }
  | {
      type: 'player:react';
      label: string;
    };

export type ServerMessage =
  | {
      type: 'room:state';
      room: RoomSnapshot;
    }
  | {
      type: 'room:left';
    }
  | {
      type: 'room:reaction';
      reaction: ReactionBurst;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
