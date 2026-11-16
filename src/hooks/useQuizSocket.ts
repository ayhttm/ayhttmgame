import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import {
  PEER_CONFIG,
  PeerRoomHost,
  peerIdForRoom,
} from '../realtime/peerRoomHost.ts';
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
export type TransportMode = 'detecting' | 'ws' | 'peer';

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

async function detectWsBackend(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function useQuizSocket() {
  const [clientId] = useState<string>(() => getOrCreateClientId());
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [transportMode, setTransportMode] = useState<TransportMode>('detecting');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const hasEverOpenedWsRef = useRef<boolean>(false);

  const peerHostRef = useRef<PeerRoomHost | null>(null);
  const peerClientRef = useRef<Peer | null>(null);
  const peerConnRef = useRef<DataConnection | null>(null);

  const activeRoomCodeRef = useRef<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem(ACTIVE_ROOM_KEY) : null
  );

  const handleServerPayload = useCallback((msg: ServerMessage) => {
    if (msg.type === 'room:state') {
      setClockOffsetMs(msg.room.serverNow - Date.now());
      setRoom(msg.room);
      setIsSubmitting(false);
      activeRoomCodeRef.current = msg.room.roomCode;
      sessionStorage.setItem(ACTIVE_ROOM_KEY, msg.room.roomCode);
      setErrorMessage(null);
    } else if (msg.type === 'room:left') {
      setRoom(null);
      setIsSubmitting(false);
      activeRoomCodeRef.current = null;
      sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    } else if (msg.type === 'room:reaction') {
      setReactions((prev) => [...prev.slice(-8), msg.reaction]);
    } else if (msg.type === 'error') {
      setIsSubmitting(false);
      if (msg.code === 'ROOM_EXPIRED' || msg.code === 'SESSION_MISSING') {
        activeRoomCodeRef.current = null;
        sessionStorage.removeItem(ACTIVE_ROOM_KEY);
        setRoom(null);
      }
      setErrorMessage(msg.message);
    }
  }, []);

  const cleanupPeerResources = useCallback(() => {
    if (peerHostRef.current) {
      peerHostRef.current.destroy();
      peerHostRef.current = null;
    }
    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (peerClientRef.current) {
      peerClientRef.current.destroy();
      peerClientRef.current = null;
    }
  }, []);

  const flushWsQueue = useCallback((ws: WebSocket) => {
    while (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
      const next = pendingQueueRef.current.shift();
      if (next) ws.send(JSON.stringify(next));
    }
  }, []);

  const activatePeerMode = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    pendingQueueRef.current = [];
    setTransportMode('peer');
    setStatus('connected');
  }, []);

  const connectWebSocket = useCallback(() => {
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

    const initialHandshakeGuard = setTimeout(() => {
      if (!hasEverOpenedWsRef.current && ws.readyState !== WebSocket.OPEN) {
        activatePeerMode();
      }
    }, 3000);

    ws.onopen = () => {
      clearTimeout(initialHandshakeGuard);
      hasEverOpenedWsRef.current = true;
      setTransportMode('ws');
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
      flushWsQueue(ws);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleServerPayload(msg);
      } catch {
        // Ignore malformed payload
      }
    };

    ws.onclose = () => {
      clearTimeout(initialHandshakeGuard);
      wsRef.current = null;
      if (!hasEverOpenedWsRef.current) {
        activatePeerMode();
        return;
      }
      setStatus('reconnecting');
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        connectWebSocket();
      }, 1500);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [activatePeerMode, clientId, flushWsQueue, handleServerPayload]);

  useEffect(() => {
    let cancelled = false;
    detectWsBackend().then((hasWs) => {
      if (cancelled) return;
      if (hasWs) {
        setTransportMode('ws');
        connectWebSocket();
      } else {
        activatePeerMode();
      }
    });

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      cleanupPeerResources();
    };
  }, [activatePeerMode, cleanupPeerResources, connectWebSocket]);

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
      if (transportMode === 'peer') {
        if (peerHostRef.current) {
          peerHostRef.current.handleHostAction(msg);
          return;
        }
        if (peerConnRef.current && peerConnRef.current.open) {
          peerConnRef.current.send(JSON.stringify(msg));
          return;
        }
        setErrorMessage('การเชื่อมต่อห้องหลุด กรุณาเข้าร่วมห้องใหม่อีกครั้ง');
        return;
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        pendingQueueRef.current.push(msg);
        connectWebSocket();
      }
    },
    [connectWebSocket, transportMode]
  );

  const createRoom = useCallback(
    (playerName: string, color: AvatarColor, quiz: QuizDeck, settings?: Partial<RoomSettings>) => {
      setErrorMessage(null);
      setIsSubmitting(true);

      if (transportMode === 'peer') {
        cleanupPeerResources();
        const host = new PeerRoomHost(
          clientId,
          playerName,
          color,
          quiz,
          settings,
          {
            onState: (snapshot) => {
              setClockOffsetMs(0);
              setRoom(snapshot);
              setIsSubmitting(false);
              activeRoomCodeRef.current = snapshot.roomCode;
              sessionStorage.setItem(ACTIVE_ROOM_KEY, snapshot.roomCode);
            },
            onReaction: (reaction) => {
              setReactions((prev) => [...prev.slice(-8), reaction]);
            },
            onError: (message) => {
              setErrorMessage(message);
              setIsSubmitting(false);
            },
          }
        );
        peerHostRef.current = host;
        host.start().catch((err) => {
          peerHostRef.current = null;
          setIsSubmitting(false);
          setErrorMessage(
            err instanceof Error ? err.message : 'ไม่สามารถเปิดห้องได้ กรุณาลองใหม่'
          );
        });
        return;
      }

      sendMessage({
        type: 'room:create',
        clientId,
        playerName,
        color,
        quiz,
        settings,
      });
    },
    [cleanupPeerResources, clientId, sendMessage, transportMode]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName: string, color: AvatarColor) => {
      const cleanCode = roomCode.trim().toUpperCase();
      setErrorMessage(null);
      setIsSubmitting(true);

      if (transportMode === 'peer') {
        cleanupPeerResources();
        const peer = new Peer(PEER_CONFIG);
        peerClientRef.current = peer;
        let joined = false;

        const joinTimeout = setTimeout(() => {
          if (!joined) {
            cleanupPeerResources();
            setIsSubmitting(false);
            setErrorMessage(
              `ไม่พบห้องรหัส "${cleanCode}" หรือผู้คุมห้องปิดหน้าจอไปแล้ว`
            );
          }
        }, 9000);

        peer.on('open', () => {
          const conn = peer.connect(peerIdForRoom(cleanCode), { reliable: true });
          peerConnRef.current = conn;

          conn.on('open', () => {
            conn.send(
              JSON.stringify({
                type: 'room:join',
                clientId,
                roomCode: cleanCode,
                playerName,
                color,
              } satisfies ClientMessage)
            );
          });

          conn.on('data', (raw) => {
            let msg: ServerMessage;
            try {
              msg = typeof raw === 'string' ? (JSON.parse(raw) as ServerMessage) : (raw as ServerMessage);
            } catch {
              return;
            }
            if (msg.type === 'room:state') {
              joined = true;
              clearTimeout(joinTimeout);
            }
            handleServerPayload(msg);
          });

          conn.on('close', () => {
            if (!joined) return;
            setErrorMessage('ผู้คุมห้องปิดห้องหรือการเชื่อมต่อสิ้นสุดลง');
          });
        });

        peer.on('error', (err: { type?: string }) => {
          clearTimeout(joinTimeout);
          cleanupPeerResources();
          setIsSubmitting(false);
          if (err.type === 'peer-unavailable') {
            setErrorMessage(
              `ไม่พบห้องรหัส "${cleanCode}" กรุณาตรวจสอบรหัสกับผู้คุมห้อง`
            );
          } else {
            setErrorMessage('ไม่สามารถเชื่อมต่อเข้าห้องได้ กรุณาลองใหม่อีกครั้ง');
          }
        });
        return;
      }

      sendMessage({
        type: 'room:join',
        clientId,
        roomCode: cleanCode,
        playerName,
        color,
      });
    },
    [cleanupPeerResources, clientId, handleServerPayload, sendMessage, transportMode]
  );

  const leaveRoom = useCallback(() => {
    activeRoomCodeRef.current = null;
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);

    if (transportMode === 'peer') {
      if (peerConnRef.current && peerConnRef.current.open) {
        peerConnRef.current.send(JSON.stringify({ type: 'room:leave' } satisfies ClientMessage));
      }
      cleanupPeerResources();
      setRoom(null);
      setIsSubmitting(false);
      return;
    }

    sendMessage({ type: 'room:leave' });
    setRoom(null);
    setIsSubmitting(false);
  }, [cleanupPeerResources, sendMessage, transportMode]);

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
    transportMode,
    isSubmitting,
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
