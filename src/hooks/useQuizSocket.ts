import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AvatarColor,
  ClientMessage,
  QuizDeck,
  ReactionBurst,
  RoomSettings,
  RoomSnapshot,
  ServerMessage,
} from '../types/quiz.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const CLIENT_ID_KEY = 'quizsync_client_id';
const ACTIVE_ROOM_KEY = 'quizsync_active_room';

function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function useQuizSocket() {
  const [clientId] = useState<string>(() => getOrCreateClientId());
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const activeRoomCodeRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem(ACTIVE_ROOM_KEY) : null
  );

  const flushQueue = useCallback((ws: WebSocket) => {
    while (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
      const next = pendingQueueRef.current.shift();
      if (next) ws.send(JSON.stringify(next));
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      setErrorMessage(null);
      if (activeRoomCodeRef.current && pendingQueueRef.current.length === 0) {
        ws.send(
          JSON.stringify({
            type: 'room:reconnect',
            clientId,
            roomCode: activeRoomCodeRef.current,
          } satisfies ClientMessage)
        );
      }
      flushQueue(ws);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === 'room:state') {
          setClockOffsetMs(msg.room.serverNow - Date.now());
          setRoom(msg.room);
          activeRoomCodeRef.current = msg.room.roomCode;
          sessionStorage.setItem(ACTIVE_ROOM_KEY, msg.room.roomCode);
          setErrorMessage(null);
        } else if (msg.type === 'room:left') {
          setRoom(null);
          activeRoomCodeRef.current = null;
          sessionStorage.removeItem(ACTIVE_ROOM_KEY);
        } else if (msg.type === 'room:reaction') {
          setReactions((prev) => [...prev.slice(-8), msg.reaction]);
        } else if (msg.type === 'error') {
          if (msg.code === 'ROOM_EXPIRED' || msg.code === 'SESSION_MISSING') {
            activeRoomCodeRef.current = null;
            sessionStorage.removeItem(ACTIVE_ROOM_KEY);
            setRoom(null);
          }
          setErrorMessage(msg.message);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setStatus('reconnecting');
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 1500);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [clientId, flushQueue]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 3200;
      setReactions((prev) => prev.filter((r) => r.createdAt > cutoff));
    }, 3300);
    return () => clearTimeout(timer);
  }, [reactions]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        pendingQueueRef.current.push(msg);
        connect();
      }
    },
    [connect]
  );

  const createRoom = useCallback(
    (playerName: string, color: AvatarColor, quiz: QuizDeck, settings?: Partial<RoomSettings>) => {
      setErrorMessage(null);
      sendMessage({
        type: 'room:create',
        clientId,
        playerName,
        color,
        quiz,
        settings,
      });
    },
    [clientId, sendMessage]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName: string, color: AvatarColor) => {
      setErrorMessage(null);
      sendMessage({
        type: 'room:join',
        clientId,
        roomCode: roomCode.trim().toUpperCase(),
        playerName,
        color,
      });
    },
    [clientId, sendMessage]
  );

  const leaveRoom = useCallback(() => {
    activeRoomCodeRef.current = null;
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    sendMessage({ type: 'room:leave' });
    setRoom(null);
  }, [sendMessage]);

  const updateSettings = useCallback(
    (settings: Partial<RoomSettings>) => {
      sendMessage({ type: 'host:update_settings', settings });
    },
    [sendMessage]
  );

  const changeQuiz = useCallback(
    (quiz: QuizDeck) => {
      sendMessage({ type: 'host:change_quiz', quiz });
    },
    [sendMessage]
  );

  const startGame = useCallback(() => {
    sendMessage({ type: 'host:start_game' });
  }, [sendMessage]);

  const submitAnswer = useCallback(
    (optionIndex: number) => {
      sendMessage({ type: 'player:submit_answer', optionIndex });
    },
    [sendMessage]
  );

  const endQuestion = useCallback(() => {
    sendMessage({ type: 'host:end_question' });
  }, [sendMessage]);

  const nextStep = useCallback(() => {
    sendMessage({ type: 'host:next_step' });
  }, [sendMessage]);

  const restartGame = useCallback(() => {
    sendMessage({ type: 'host:restart_game' });
  }, [sendMessage]);

  const sendReaction = useCallback(
    (label: string) => {
      sendMessage({ type: 'player:react', label });
    },
    [sendMessage]
  );

  return {
    clientId,
    status,
    room,
    errorMessage,
    clearError: () => setErrorMessage(null),
    reactions,
    clockOffsetMs,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    changeQuiz,
    startGame,
    submitAnswer,
    endQuestion,
    nextStep,
    restartGame,
    sendReaction,
  };
}
