import Peer, { type DataConnection } from 'peerjs';
import type {
  AvatarColor,
  ClientMessage,
  GamePhase,
  PlayerSnapshot,
  QuizDeck,
  ReactionBurst,
  RoomSettings,
  RoomSnapshot,
  ServerMessage,
} from '../types/quiz.ts';

interface PeerPlayer {
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
  selectedOption: number | null;
  pendingRoundScore: number;
  pendingCorrect: boolean;
}

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COUNTDOWN_MS = 3000;
const AUTO_REVEAL_MS = 4500;
const AUTO_LEADERBOARD_MS = 4000;

export const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

export function peerIdForRoom(roomCode: string): string {
  return `quizsync-room-${roomCode.trim().toUpperCase()}`;
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

export interface PeerHostCallbacks {
  onState: (room: RoomSnapshot) => void;
  onReaction: (reaction: ReactionBurst) => void;
  onError: (message: string) => void;
}

export class PeerRoomHost {
  public roomCode = '';
  private peer: Peer | null = null;
  private connections = new Map<string, DataConnection>();
  private connToClient = new Map<DataConnection, string>();
  private players = new Map<string, PeerPlayer>();
  private phase: GamePhase = 'LOBBY';
  private quiz: QuizDeck;
  private currentQuestionIndex = 0;
  private phaseStartedAt = Date.now();
  private phaseDurationMs = 0;
  private settings: RoomSettings;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private hostClientId: string;
  private callbacks: PeerHostCallbacks;

  constructor(
    hostClientId: string,
    hostName: string,
    hostColor: AvatarColor,
    quiz: QuizDeck,
    settings: Partial<RoomSettings> | undefined,
    callbacks: PeerHostCallbacks
  ) {
    this.hostClientId = hostClientId;
    this.quiz = quiz;
    const hostPlays = settings?.hostPlays ?? true;
    this.settings = {
      hostPlays,
      autoAdvance: settings?.autoAdvance ?? false,
    };
    this.callbacks = callbacks;

    this.players.set(hostClientId, {
      clientId: hostClientId,
      name: hostName.trim().slice(0, 24) || 'ผู้คุมห้อง',
      color: hostColor,
      isHost: true,
      isPlaying: hostPlays,
      connected: true,
      score: 0,
      lastRoundScore: 0,
      streak: 0,
      correctCount: 0,
      selectedOption: null,
      pendingRoundScore: 0,
      pendingCorrect: false,
    });
  }

  public start(): Promise<string> {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryOpen = () => {
        if (this.destroyed) {
          reject(new Error('Host destroyed'));
          return;
        }
        attempts += 1;
        const candidateCode = generateRoomCode();
        const peer = new Peer(peerIdForRoom(candidateCode), PEER_CONFIG);
        let settled = false;

        const openTimeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            peer.destroy();
            reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ห้อง P2P ไม่ทันเวลา กรุณาลองใหม่อีกครั้ง'));
          }
        }, 10000);

        peer.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(openTimeout);
          this.roomCode = candidateCode;
          this.peer = peer;
          this.attachPeerListeners(peer);
          this.broadcastState();
          resolve(candidateCode);
        });

        peer.on('error', (err: { type?: string; message?: string }) => {
          if (!settled) {
            clearTimeout(openTimeout);
            settled = true;
            peer.destroy();
            if (err.type === 'unavailable-id' && attempts < 5) {
              tryOpen();
              return;
            }
            reject(new Error('ไม่สามารถเปิดห้องออนไลน์ได้ กรุณาลองใหม่อีกครั้ง'));
          }
        });
      };

      tryOpen();
    });
  }

  private attachPeerListeners(peer: Peer) {
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        if (this.destroyed) return;
        let msg: ClientMessage;
        try {
          msg = typeof raw === 'string' ? (JSON.parse(raw) as ClientMessage) : (raw as ClientMessage);
        } catch {
          return;
        }
        this.handleClientMessage(conn, msg);
      });

      conn.on('close', () => {
        const cid = this.connToClient.get(conn);
        if (!cid) return;
        this.connToClient.delete(conn);
        if (this.connections.get(cid) === conn) {
          this.connections.delete(cid);
          const p = this.players.get(cid);
          if (p) {
            if (this.phase === 'LOBBY') {
              this.players.delete(cid);
            } else {
              p.connected = false;
              this.checkAllAnswered();
            }
            this.broadcastState();
          }
        }
      });
    });

    peer.on('disconnected', () => {
      if (!this.destroyed && peer && !peer.destroyed) {
        peer.reconnect();
      }
    });
  }

  private sendToConn(conn: DataConnection, payload: ServerMessage) {
    if (conn.open) {
      conn.send(JSON.stringify(payload));
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildSnapshot(): RoomSnapshot {
    const showAnswer =
      this.phase === 'REVEAL' ||
      this.phase === 'LEADERBOARD' ||
      this.phase === 'FINAL_PODIUM';
    const rawQuestion =
      this.phase === 'LOBBY'
        ? null
        : this.quiz.questions[this.currentQuestionIndex] ?? null;

    let currentQuestion = null;
    let optionCounts: number[] | null = null;

    if (rawQuestion) {
      const timeLimitSec = rawQuestion.timeLimitSec ?? this.quiz.defaultTimeLimitSec;
      currentQuestion = {
        id: rawQuestion.id,
        prompt: rawQuestion.prompt,
        options: rawQuestion.options,
        timeLimitSec,
        ...(showAnswer
          ? {
              correctIndex: rawQuestion.correctIndex,
              explanation: rawQuestion.explanation,
            }
          : {}),
      };

      if (showAnswer) {
        optionCounts = new Array(rawQuestion.options.length).fill(0);
        for (const player of this.players.values()) {
          if (
            player.isPlaying &&
            player.selectedOption !== null &&
            player.selectedOption >= 0 &&
            player.selectedOption < optionCounts.length
          ) {
            optionCounts[player.selectedOption] += 1;
          }
        }
      }
    }

    let activePlayerCount = 0;
    let answeredCount = 0;
    const players: PlayerSnapshot[] = [];

    for (const p of this.players.values()) {
      if (p.isPlaying && p.connected) activePlayerCount += 1;
      if (p.isPlaying && p.selectedOption !== null) answeredCount += 1;
      players.push({
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        isHost: p.isHost,
        isPlaying: p.isPlaying,
        connected: p.connected,
        score: p.score,
        lastRoundScore: p.lastRoundScore,
        streak: p.streak,
        correctCount: p.correctCount,
        answeredCurrent: p.selectedOption !== null,
        selectedOption: showAnswer ? p.selectedOption : null,
      });
    }

    players.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return a.name.localeCompare(b.name, 'th');
    });

    return {
      roomCode: this.roomCode,
      phase: this.phase,
      quizTitle: this.quiz.title,
      quizCategory: this.quiz.category,
      totalQuestions: this.quiz.questions.length,
      currentQuestionIndex: this.currentQuestionIndex,
      phaseStartedAt: this.phaseStartedAt,
      phaseDurationMs: this.phaseDurationMs,
      serverNow: Date.now(),
      settings: this.settings,
      players,
      currentQuestion,
      optionCounts,
      activePlayerCount,
      answeredCount,
    };
  }

  private broadcastState() {
    if (this.destroyed) return;
    const snapshot = this.buildSnapshot();
    this.callbacks.onState(snapshot);

    const serialized = JSON.stringify({
      type: 'room:state',
      room: snapshot,
    } satisfies ServerMessage);

    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(serialized);
      }
    }
  }

  private broadcastReaction(reaction: ReactionBurst) {
    if (this.destroyed) return;
    this.callbacks.onReaction(reaction);

    const serialized = JSON.stringify({
      type: 'room:reaction',
      reaction,
    } satisfies ServerMessage);

    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(serialized);
      }
    }
  }

  private handleClientMessage(conn: DataConnection, msg: ClientMessage) {
    if (msg.type === 'room:join') {
      const existing = this.players.get(msg.clientId);
      if (existing) {
        existing.name = msg.playerName.trim().slice(0, 24) || 'ผู้เล่น';
        existing.color = msg.color;
        existing.connected = true;
      } else {
        this.players.set(msg.clientId, {
          clientId: msg.clientId,
          name: msg.playerName.trim().slice(0, 24) || 'ผู้เล่น',
          color: msg.color,
          isHost: false,
          isPlaying: true,
          connected: true,
          score: 0,
          lastRoundScore: 0,
          streak: 0,
          correctCount: 0,
          selectedOption: null,
          pendingRoundScore: 0,
          pendingCorrect: false,
        });
      }
      this.connections.set(msg.clientId, conn);
      this.connToClient.set(conn, msg.clientId);
      this.broadcastState();
      return;
    }

    if (msg.type === 'room:reconnect') {
      const existing = this.players.get(msg.clientId);
      if (!existing) {
        this.sendToConn(conn, {
          type: 'error',
          code: 'SESSION_MISSING',
          message: 'กรุณากรอกชื่อเพื่อเข้าร่วมห้องอีกครั้ง',
        });
        return;
      }
      existing.connected = true;
      this.connections.set(msg.clientId, conn);
      this.connToClient.set(conn, msg.clientId);
      this.broadcastState();
      return;
    }

    const clientId = this.connToClient.get(conn);
    if (!clientId) return;

    if (msg.type === 'room:leave') {
      this.connections.delete(clientId);
      this.connToClient.delete(conn);
      this.players.delete(clientId);
      this.sendToConn(conn, { type: 'room:left' });
      this.checkAllAnswered();
      this.broadcastState();
      return;
    }

    this.handlePlayerAction(clientId, msg);
  }

  public handleHostAction(msg: ClientMessage) {
    this.handlePlayerAction(this.hostClientId, msg);
  }

  private handlePlayerAction(clientId: string, msg: ClientMessage) {
    const sender = this.players.get(clientId);
    if (!sender) return;

    if (msg.type === 'player:react') {
      const label = typeof msg.label === 'string' ? msg.label.trim().slice(0, 24) : '';
      if (!label) return;
      this.broadcastReaction({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        senderName: sender.name,
        label,
        createdAt: Date.now(),
      });
      return;
    }

    if (msg.type === 'player:submit_answer') {
      if (this.phase !== 'QUESTION' || !sender.isPlaying) return;
      if (sender.selectedOption !== null) return;
      const q = this.quiz.questions[this.currentQuestionIndex];
      if (!q || msg.optionIndex < 0 || msg.optionIndex >= q.options.length) return;

      const elapsedMs = Math.max(0, Date.now() - this.phaseStartedAt);
      const remainingRatio = Math.max(0, 1 - elapsedMs / Math.max(1, this.phaseDurationMs));
      const isCorrect = msg.optionIndex === q.correctIndex;

      sender.selectedOption = msg.optionIndex;
      sender.pendingCorrect = isCorrect;
      sender.pendingRoundScore = isCorrect ? Math.round(500 + 500 * remainingRatio) : 0;

      this.broadcastState();
      this.checkAllAnswered();
      return;
    }

    if (!sender.isHost) return;

    if (msg.type === 'host:update_settings') {
      if (this.phase !== 'LOBBY') return;
      if (typeof msg.settings.hostPlays === 'boolean') {
        this.settings.hostPlays = msg.settings.hostPlays;
        sender.isPlaying = msg.settings.hostPlays;
      }
      if (typeof msg.settings.autoAdvance === 'boolean') {
        this.settings.autoAdvance = msg.settings.autoAdvance;
      }
      this.broadcastState();
      return;
    }

    if (msg.type === 'host:change_quiz') {
      if (this.phase !== 'LOBBY') return;
      this.quiz = msg.quiz;
      this.currentQuestionIndex = 0;
      this.broadcastState();
      return;
    }

    if (msg.type === 'host:start_game') {
      if (this.phase !== 'LOBBY') return;
      const playingCount = Array.from(this.players.values()).filter((p) => p.isPlaying).length;
      if (playingCount === 0) {
        this.callbacks.onError('ต้องมีผู้เล่นอย่างน้อย 1 คน (หรือเปิดโหมดผู้คุมห้องร่วมเล่นด้วย)');
        return;
      }
      for (const p of this.players.values()) {
        p.score = 0;
        p.lastRoundScore = 0;
        p.streak = 0;
        p.correctCount = 0;
        p.selectedOption = null;
        p.pendingRoundScore = 0;
        p.pendingCorrect = false;
      }
      this.currentQuestionIndex = 0;
      this.startCountdown();
      return;
    }

    if (msg.type === 'host:end_question') {
      if (this.phase === 'QUESTION') this.revealQuestion();
      return;
    }

    if (msg.type === 'host:next_step') {
      if (this.phase === 'REVEAL') {
        this.advanceAfterReveal();
      } else if (this.phase === 'LEADERBOARD') {
        this.clearTimer();
        this.currentQuestionIndex += 1;
        if (this.currentQuestionIndex >= this.quiz.questions.length) {
          this.finishGame();
        } else {
          this.startCountdown();
        }
      }
      return;
    }

    if (msg.type === 'host:restart_game') {
      this.clearTimer();
      this.phase = 'LOBBY';
      this.currentQuestionIndex = 0;
      this.phaseStartedAt = Date.now();
      this.phaseDurationMs = 0;
      for (const p of this.players.values()) {
        p.score = 0;
        p.lastRoundScore = 0;
        p.streak = 0;
        p.correctCount = 0;
        p.selectedOption = null;
        p.pendingRoundScore = 0;
        p.pendingCorrect = false;
      }
      this.broadcastState();
    }
  }

  private checkAllAnswered() {
    if (this.phase !== 'QUESTION') return;
    const active = Array.from(this.players.values()).filter(
      (p) => p.isPlaying && p.connected
    );
    if (active.length > 0 && active.every((p) => p.selectedOption !== null)) {
      this.clearTimer();
      this.timer = setTimeout(() => this.revealQuestion(), 350);
    }
  }

  private startCountdown() {
    this.clearTimer();
    for (const p of this.players.values()) {
      p.selectedOption = null;
      p.pendingRoundScore = 0;
      p.pendingCorrect = false;
      p.lastRoundScore = 0;
    }
    this.phase = 'COUNTDOWN';
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = COUNTDOWN_MS;
    this.broadcastState();
    this.timer = setTimeout(() => this.startQuestion(), COUNTDOWN_MS);
  }

  private startQuestion() {
    this.clearTimer();
    const q = this.quiz.questions[this.currentQuestionIndex];
    if (!q) {
      this.finishGame();
      return;
    }
    const limitMs = (q.timeLimitSec ?? this.quiz.defaultTimeLimitSec) * 1000;
    this.phase = 'QUESTION';
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = limitMs;
    this.broadcastState();
    this.timer = setTimeout(() => this.revealQuestion(), limitMs);
  }

  private revealQuestion() {
    if (this.phase !== 'QUESTION') return;
    this.clearTimer();

    for (const p of this.players.values()) {
      if (!p.isPlaying) continue;
      if (p.selectedOption !== null && p.pendingCorrect) {
        p.streak += 1;
        p.correctCount += 1;
        const streakBonus = Math.min(500, Math.max(0, (p.streak - 1) * 100));
        const earned = p.pendingRoundScore + streakBonus;
        p.lastRoundScore = earned;
        p.score += earned;
      } else {
        p.streak = 0;
        p.lastRoundScore = 0;
      }
    }

    this.phase = 'REVEAL';
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = this.settings.autoAdvance ? AUTO_REVEAL_MS : 0;
    this.broadcastState();

    if (this.settings.autoAdvance) {
      this.timer = setTimeout(() => this.advanceAfterReveal(), AUTO_REVEAL_MS);
    }
  }

  private advanceAfterReveal() {
    this.clearTimer();
    const isLast = this.currentQuestionIndex >= this.quiz.questions.length - 1;
    if (isLast) {
      this.finishGame();
      return;
    }

    this.phase = 'LEADERBOARD';
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = this.settings.autoAdvance ? AUTO_LEADERBOARD_MS : 0;
    this.broadcastState();

    if (this.settings.autoAdvance) {
      this.timer = setTimeout(() => {
        this.currentQuestionIndex += 1;
        this.startCountdown();
      }, AUTO_LEADERBOARD_MS);
    }
  }

  private finishGame() {
    this.clearTimer();
    this.phase = 'FINAL_PODIUM';
    this.phaseStartedAt = Date.now();
    this.phaseDurationMs = 0;
    this.broadcastState();
  }

  public destroy() {
    this.destroyed = true;
    this.clearTimer();
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.connToClient.clear();
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }
    this.peer = null;
  }
}
