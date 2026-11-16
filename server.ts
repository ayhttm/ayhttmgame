import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AvatarColor,
  ClientMessage,
  GamePhase,
  PlayerSnapshot,
  QuizDeck,
  QuizQuestion,
  RoomSettings,
  RoomSnapshot,
  ServerMessage,
} from './src/types/quiz.ts';

interface RoomPlayer {
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

interface RoomState {
  roomCode: string;
  hostClientId: string;
  phase: GamePhase;
  quiz: QuizDeck;
  currentQuestionIndex: number;
  phaseStartedAt: number;
  phaseDurationMs: number;
  settings: RoomSettings;
  players: Map<string, RoomPlayer>;
  sockets: Map<string, WebSocket>;
  timer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
}

const PORT = Number(process.env.PORT) || 3000;
const COUNTDOWN_MS = 3000;
const AUTO_REVEAL_MS = 4500;
const AUTO_LEADERBOARD_MS = 4000;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VALID_COLORS: AvatarColor[] = ['indigo', 'rose', 'emerald', 'amber', 'sky', 'violet'];

const rooms = new Map<string, RoomState>();
const socketMeta = new WeakMap<WebSocket, { roomCode: string; clientId: string }>();

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sanitizeColor(color: unknown): AvatarColor {
  return VALID_COLORS.includes(color as AvatarColor) ? (color as AvatarColor) : 'indigo';
}

function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'ผู้เล่น';
  const trimmed = name.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : 'ผู้เล่น';
}

function sanitizeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300000) return undefined;
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }
  return undefined;
}

function sanitizeQuiz(raw: QuizDeck): QuizDeck | null {
  if (!raw || !Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  const defaultSec = Math.min(60, Math.max(5, Number(raw.defaultTimeLimitSec) || 15));
  const cleanQuestions: QuizQuestion[] = [];

  for (let i = 0; i < raw.questions.length && i < 50; i++) {
    const q = raw.questions[i];
    if (!q || typeof q.prompt !== 'string' || !Array.isArray(q.options)) continue;
    const options = q.options
      .map((opt) => (typeof opt === 'string' ? opt.trim().slice(0, 120) : ''))
      .filter((opt) => opt.length > 0)
      .slice(0, 4);
    if (options.length < 2) continue;

    const correctIndex =
      typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < options.length
        ? q.correctIndex
        : 0;

    cleanQuestions.push({
      id: typeof q.id === 'string' && q.id ? q.id : `q-${i + 1}`,
      prompt: q.prompt.trim().slice(0, 240) || `คำถามข้อที่ ${i + 1}`,
      options,
      correctIndex,
      timeLimitSec: q.timeLimitSec
        ? Math.min(60, Math.max(5, Number(q.timeLimitSec)))
        : undefined,
      explanation:
        typeof q.explanation === 'string' && q.explanation.trim()
          ? q.explanation.trim().slice(0, 260)
          : undefined,
      imageUrl: sanitizeImageUrl(q.imageUrl),
    });
  }

  if (cleanQuestions.length === 0) return null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'custom-quiz',
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 80)
        : 'ควิซออนไลน์',
    category:
      typeof raw.category === 'string' && raw.category.trim()
        ? raw.category.trim().slice(0, 40)
        : 'ทั่วไป',
    description:
      typeof raw.description === 'string' ? raw.description.trim().slice(0, 200) : '',
    defaultTimeLimitSec: defaultSec,
    questions: cleanQuestions,
    isCustom: Boolean(raw.isCustom),
  };
}

function clearRoomTimer(room: RoomState) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function sendJson(ws: WebSocket | undefined, payload: ServerMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function buildSnapshot(room: RoomState): RoomSnapshot {
  const showAnswer =
    room.phase === 'REVEAL' || room.phase === 'LEADERBOARD' || room.phase === 'FINAL_PODIUM';
  const rawQuestion =
    room.phase === 'LOBBY'
      ? null
      : room.quiz.questions[room.currentQuestionIndex] ?? null;

  let currentQuestion = null;
  let optionCounts: number[] | null = null;

  if (rawQuestion) {
    const timeLimitSec = rawQuestion.timeLimitSec ?? room.quiz.defaultTimeLimitSec;
    currentQuestion = {
      id: rawQuestion.id,
      prompt: rawQuestion.prompt,
      options: rawQuestion.options,
      timeLimitSec,
      ...(rawQuestion.imageUrl ? { imageUrl: rawQuestion.imageUrl } : {}),
      ...(showAnswer
        ? {
            correctIndex: rawQuestion.correctIndex,
            explanation: rawQuestion.explanation,
          }
        : {}),
    };

    if (showAnswer) {
      optionCounts = new Array(rawQuestion.options.length).fill(0);
      for (const player of room.players.values()) {
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

  for (const p of room.players.values()) {
    if (p.isPlaying && p.connected) {
      activePlayerCount += 1;
    }
    if (p.isPlaying && p.selectedOption !== null) {
      answeredCount += 1;
    }
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
    roomCode: room.roomCode,
    phase: room.phase,
    quizId: room.quiz.id,
    quizTitle: room.quiz.title,
    quizCategory: room.quiz.category,
    totalQuestions: room.quiz.questions.length,
    currentQuestionIndex: room.currentQuestionIndex,
    phaseStartedAt: room.phaseStartedAt,
    phaseDurationMs: room.phaseDurationMs,
    serverNow: Date.now(),
    settings: room.settings,
    players,
    currentQuestion,
    optionCounts,
    activePlayerCount,
    answeredCount,
  };
}

function broadcastRoom(room: RoomState) {
  room.lastActivityAt = Date.now();
  const snapshot = buildSnapshot(room);
  const message: ServerMessage = { type: 'room:state', room: snapshot };
  const serialized = JSON.stringify(message);
  for (const ws of room.sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function startCountdown(room: RoomState) {
  clearRoomTimer(room);
  for (const player of room.players.values()) {
    player.selectedOption = null;
    player.pendingRoundScore = 0;
    player.pendingCorrect = false;
    player.lastRoundScore = 0;
  }

  room.phase = 'COUNTDOWN';
  room.phaseStartedAt = Date.now();
  room.phaseDurationMs = COUNTDOWN_MS;
  broadcastRoom(room);

  room.timer = setTimeout(() => {
    startQuestion(room);
  }, COUNTDOWN_MS);
}

function startQuestion(room: RoomState) {
  clearRoomTimer(room);
  const question = room.quiz.questions[room.currentQuestionIndex];
  if (!question) {
    finishGame(room);
    return;
  }

  const limitMs = (question.timeLimitSec ?? room.quiz.defaultTimeLimitSec) * 1000;
  room.phase = 'QUESTION';
  room.phaseStartedAt = Date.now();
  room.phaseDurationMs = limitMs;
  broadcastRoom(room);

  room.timer = setTimeout(() => {
    revealQuestion(room);
  }, limitMs);
}

function revealQuestion(room: RoomState) {
  if (room.phase !== 'QUESTION') return;
  clearRoomTimer(room);

  for (const player of room.players.values()) {
    if (!player.isPlaying) continue;
    if (player.selectedOption !== null && player.pendingCorrect) {
      player.streak += 1;
      player.correctCount += 1;
      const streakBonus = Math.min(500, Math.max(0, (player.streak - 1) * 100));
      const totalEarned = player.pendingRoundScore + streakBonus;
      player.lastRoundScore = totalEarned;
      player.score += totalEarned;
    } else {
      player.streak = 0;
      player.lastRoundScore = 0;
    }
  }

  room.phase = 'REVEAL';
  room.phaseStartedAt = Date.now();
  room.phaseDurationMs = room.settings.autoAdvance ? AUTO_REVEAL_MS : 0;
  broadcastRoom(room);

  if (room.settings.autoAdvance) {
    room.timer = setTimeout(() => {
      advanceAfterReveal(room);
    }, AUTO_REVEAL_MS);
  }
}

function advanceAfterReveal(room: RoomState) {
  clearRoomTimer(room);
  const isLast = room.currentQuestionIndex >= room.quiz.questions.length - 1;
  if (isLast) {
    finishGame(room);
    return;
  }

  room.phase = 'LEADERBOARD';
  room.phaseStartedAt = Date.now();
  room.phaseDurationMs = room.settings.autoAdvance ? AUTO_LEADERBOARD_MS : 0;
  broadcastRoom(room);

  if (room.settings.autoAdvance) {
    room.timer = setTimeout(() => {
      room.currentQuestionIndex += 1;
      startCountdown(room);
    }, AUTO_LEADERBOARD_MS);
  }
}

function finishGame(room: RoomState) {
  clearRoomTimer(room);
  room.phase = 'FINAL_PODIUM';
  room.phaseStartedAt = Date.now();
  room.phaseDurationMs = 0;
  broadcastRoom(room);
}

function removeClientFromRoom(room: RoomState, clientId: string, fullLeave: boolean) {
  const player = room.players.get(clientId);
  room.sockets.delete(clientId);

  if (!player) return;

  if (fullLeave || room.phase === 'LOBBY') {
    room.players.delete(clientId);
    if (player.isHost && room.players.size > 0) {
      const nextHost =
        Array.from(room.players.values()).find((p) => p.connected) ??
        Array.from(room.players.values())[0];
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.isPlaying = true;
        room.hostClientId = nextHost.clientId;
      }
    }
  } else {
    player.connected = false;
  }

  if (room.players.size === 0 || Array.from(room.players.values()).every((p) => !p.connected)) {
    if (room.players.size === 0) {
      clearRoomTimer(room);
      rooms.delete(room.roomCode);
      return;
    }
  }

  if (room.phase === 'QUESTION') {
    const activePlayers = Array.from(room.players.values()).filter(
      (p) => p.isPlaying && p.connected
    );
    if (activePlayers.length > 0 && activePlayers.every((p) => p.selectedOption !== null)) {
      clearRoomTimer(room);
      room.timer = setTimeout(() => revealQuestion(room), 300);
    }
  }

  broadcastRoom(room);
}

// Cleanup abandoned rooms every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (!anyConnected && room.lastActivityAt < cutoff) {
      clearRoomTimer(room);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ exists: false, message: 'ไม่พบห้องนี้ในระบบ' });
      return;
    }
    res.json({
      exists: true,
      roomCode: room.roomCode,
      phase: room.phase,
      quizTitle: room.quiz.title,
      playerCount: room.players.size,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (rawData) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(rawData.toString()) as ClientMessage;
      } catch {
        sendJson(ws, { type: 'error', code: 'BAD_JSON', message: 'รูปแบบข้อความไม่ถูกต้อง' });
        return;
      }

      if (msg.type === 'room:create') {
        const cleanQuiz = sanitizeQuiz(msg.quiz);
        if (!cleanQuiz) {
          sendJson(ws, {
            type: 'error',
            code: 'INVALID_QUIZ',
            message: 'ชุดคำถามต้องมีอย่างน้อย 1 ข้อและตัวเลือกอย่างน้อย 2 ข้อ',
          });
          return;
        }
        const clientId = typeof msg.clientId === 'string' && msg.clientId ? msg.clientId : `c-${Date.now()}`;
        const prev = socketMeta.get(ws);
        if (prev) {
          const oldRoom = rooms.get(prev.roomCode);
          if (oldRoom) removeClientFromRoom(oldRoom, prev.clientId, true);
        }

        const roomCode = generateRoomCode();
        const hostPlays = msg.settings?.hostPlays ?? true;
        const autoAdvance = msg.settings?.autoAdvance ?? false;

        const room: RoomState = {
          roomCode,
          hostClientId: clientId,
          phase: 'LOBBY',
          quiz: cleanQuiz,
          currentQuestionIndex: 0,
          phaseStartedAt: Date.now(),
          phaseDurationMs: 0,
          settings: { hostPlays, autoAdvance },
          players: new Map(),
          sockets: new Map(),
          timer: null,
          lastActivityAt: Date.now(),
        };

        room.players.set(clientId, {
          clientId,
          name: sanitizeName(msg.playerName),
          color: sanitizeColor(msg.color),
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
        room.sockets.set(clientId, ws);
        rooms.set(roomCode, room);
        socketMeta.set(ws, { roomCode, clientId });
        broadcastRoom(room);
        return;
      }

      if (msg.type === 'room:join') {
        const code = String(msg.roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `ไม่พบห้องรหัส "${code}" กรุณาตรวจสอบรหัสอีกครั้ง`,
          });
          return;
        }

        const clientId = typeof msg.clientId === 'string' && msg.clientId ? msg.clientId : `c-${Date.now()}`;
        const existing = room.players.get(clientId);

        if (existing) {
          existing.name = sanitizeName(msg.playerName);
          existing.color = sanitizeColor(msg.color);
          existing.connected = true;
        } else {
          room.players.set(clientId, {
            clientId,
            name: sanitizeName(msg.playerName),
            color: sanitizeColor(msg.color),
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

        room.sockets.set(clientId, ws);
        socketMeta.set(ws, { roomCode: code, clientId });
        broadcastRoom(room);
        return;
      }

      if (msg.type === 'room:reconnect') {
        const code = String(msg.roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'error',
            code: 'ROOM_EXPIRED',
            message: 'ห้องนี้ปิดตัวลงแล้ว',
          });
          return;
        }

        const player = room.players.get(msg.clientId);
        if (!player) {
          sendJson(ws, {
            type: 'error',
            code: 'SESSION_MISSING',
            message: 'กรุณากรอกชื่อเพื่อเข้าร่วมห้องอีกครั้ง',
          });
          return;
        }

        player.connected = true;
        room.sockets.set(msg.clientId, ws);
        socketMeta.set(ws, { roomCode: code, clientId: msg.clientId });
        broadcastRoom(room);
        return;
      }

      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      const sender = room.players.get(meta.clientId);
      if (!sender) return;

      if (msg.type === 'room:leave') {
        socketMeta.delete(ws);
        removeClientFromRoom(room, meta.clientId, true);
        sendJson(ws, { type: 'room:left' });
        return;
      }

      if (msg.type === 'player:react') {
        const label = typeof msg.label === 'string' ? msg.label.trim().slice(0, 24) : '';
        if (!label) return;
        const payload: ServerMessage = {
          type: 'room:reaction',
          reaction: {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            senderName: sender.name,
            label,
            createdAt: Date.now(),
          },
        };
        const serialized = JSON.stringify(payload);
        for (const clientWs of room.sockets.values()) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(serialized);
          }
        }
        return;
      }

      if (msg.type === 'player:submit_answer') {
        if (room.phase !== 'QUESTION' || !sender.isPlaying) return;
        if (sender.selectedOption !== null) return;

        const question = room.quiz.questions[room.currentQuestionIndex];
        if (!question) return;
        if (
          typeof msg.optionIndex !== 'number' ||
          msg.optionIndex < 0 ||
          msg.optionIndex >= question.options.length
        ) {
          return;
        }

        const elapsedMs = Math.max(0, Date.now() - room.phaseStartedAt);
        const remainingRatio = Math.max(0, 1 - elapsedMs / Math.max(1, room.phaseDurationMs));
        const isCorrect = msg.optionIndex === question.correctIndex;

        sender.selectedOption = msg.optionIndex;
        sender.pendingCorrect = isCorrect;
        sender.pendingRoundScore = isCorrect ? Math.round(500 + 500 * remainingRatio) : 0;

        broadcastRoom(room);

        const activePlayers = Array.from(room.players.values()).filter(
          (p) => p.isPlaying && p.connected
        );
        if (activePlayers.length > 0 && activePlayers.every((p) => p.selectedOption !== null)) {
          clearRoomTimer(room);
          room.timer = setTimeout(() => {
            revealQuestion(room);
          }, 350);
        }
        return;
      }

      // Host-only commands below
      if (!sender.isHost) {
        sendJson(ws, {
          type: 'error',
          code: 'NOT_HOST',
          message: 'เฉพาะผู้คุมห้องเท่านั้นที่สามารถควบคุมเกมได้',
        });
        return;
      }

      if (msg.type === 'host:update_settings') {
        if (room.phase !== 'LOBBY') return;
        if (typeof msg.settings.hostPlays === 'boolean') {
          room.settings.hostPlays = msg.settings.hostPlays;
          sender.isPlaying = msg.settings.hostPlays;
        }
        if (typeof msg.settings.autoAdvance === 'boolean') {
          room.settings.autoAdvance = msg.settings.autoAdvance;
        }
        broadcastRoom(room);
        return;
      }

      if (msg.type === 'host:change_quiz') {
        if (room.phase !== 'LOBBY') return;
        const cleanQuiz = sanitizeQuiz(msg.quiz);
        if (!cleanQuiz) return;
        room.quiz = cleanQuiz;
        room.currentQuestionIndex = 0;
        broadcastRoom(room);
        return;
      }

      if (msg.type === 'host:start_game') {
        if (room.phase !== 'LOBBY') return;
        const playingCount = Array.from(room.players.values()).filter((p) => p.isPlaying).length;
        if (playingCount === 0) {
          sendJson(ws, {
            type: 'error',
            code: 'NO_PLAYERS',
            message: 'ต้องมีผู้เล่นอย่างน้อย 1 คน (หรือเปิดโหมดผู้คุมห้องร่วมเล่นด้วย)',
          });
          return;
        }

        for (const p of room.players.values()) {
          p.score = 0;
          p.lastRoundScore = 0;
          p.streak = 0;
          p.correctCount = 0;
          p.selectedOption = null;
          p.pendingRoundScore = 0;
          p.pendingCorrect = false;
        }
        room.currentQuestionIndex = 0;
        startCountdown(room);
        return;
      }

      if (msg.type === 'host:end_question') {
        if (room.phase === 'QUESTION') {
          revealQuestion(room);
        }
        return;
      }

      if (msg.type === 'host:next_step') {
        if (room.phase === 'REVEAL') {
          advanceAfterReveal(room);
        } else if (room.phase === 'LEADERBOARD') {
          clearRoomTimer(room);
          room.currentQuestionIndex += 1;
          if (room.currentQuestionIndex >= room.quiz.questions.length) {
            finishGame(room);
          } else {
            startCountdown(room);
          }
        }
        return;
      }

      if (msg.type === 'host:restart_game') {
        clearRoomTimer(room);
        if (msg.quiz) {
          const cleanQuiz = sanitizeQuiz(msg.quiz);
          if (cleanQuiz) {
            room.quiz = cleanQuiz;
          }
        }
        room.phase = 'LOBBY';
        room.currentQuestionIndex = 0;
        room.phaseStartedAt = Date.now();
        room.phaseDurationMs = 0;
        for (const p of room.players.values()) {
          p.score = 0;
          p.lastRoundScore = 0;
          p.streak = 0;
          p.correctCount = 0;
          p.selectedOption = null;
          p.pendingRoundScore = 0;
          p.pendingCorrect = false;
        }
        broadcastRoom(room);
      }
    });

    ws.on('close', () => {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      if (room.sockets.get(meta.clientId) === ws) {
        removeClientFromRoom(room, meta.clientId, false);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`QuizSync server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
