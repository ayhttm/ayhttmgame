import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import {
  PEER_CONFIG,
  PeerRoomHost,
  PeerSignalingError,
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

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'timed_out'
  | 'disconnected';
export type TransportMode = 'detecting' | 'ws' | 'peer';

type PendingRoomAction =
  | {
      kind: 'create';
      playerName: string;
      color: AvatarColor;
      quiz: QuizDeck;
      settings?: Partial<RoomSettings>;
    }
  | {
      kind: 'join';
      roomCode: string;
      playerName: string;
      color: AvatarColor;
    };

const CLIENT_ID_KEY = 'quizsync_client_id';
const ACTIVE_ROOM_KEY = 'quizsync_active_room';
const ACTIVE_ROLE_KEY = 'quizsync_active_role';

const WS_HANDSHAKE_TIMEOUT_MS = 3500;
const WS_MAX_RETRIES = 4;
const PEER_SIGNALING_TIMEOUT_MS = 6000;
const PEER_LOOKUP_TIMEOUT_MS = 7500;
const PEER_SIGNALING_MAX_RETRIES = 2;

function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function safeReadSession(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteSession(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage errors
  }
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

  const transportModeRef = useRef<TransportMode>('detecting');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalingProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const pendingRoomActionRef = useRef<PendingRoomAction | null>(null);
  const hasEverOpenedWsRef = useRef<boolean>(false);
  const wsRetriesRef = useRef<number>(0);
  const attemptIdRef = useRef<number>(0);
  const probeAttemptRef = useRef<number>(0);

  const peerHostRef = useRef<PeerRoomHost | null>(null);
  const peerClientRef = useRef<Peer | null>(null);
  const peerConnRef = useRef<DataConnection | null>(null);
  const peerProbeRef = useRef<Peer | null>(null);

  const activeRoomCodeRef = useRef<string | null>(safeReadSession(ACTIVE_ROOM_KEY));

  const setTransport = useCallback((mode: TransportMode) => {
    transportModeRef.current = mode;
    setTransportMode(mode);
  }, []);

  const clearSubmitGuard = useCallback(() => {
    if (submitGuardTimerRef.current) {
      clearTimeout(submitGuardTimerRef.current);
      submitGuardTimerRef.current = null;
    }
  }, []);

  const startSubmitGuard = useCallback(
    (attemptId: number) => {
      clearSubmitGuard();
      submitGuardTimerRef.current = setTimeout(() => {
        if (attemptId !== attemptIdRef.current) return;
        setIsSubmitting(false);
        setStatus('timed_out');
        setErrorMessage(
          'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out) กรุณาลองเชื่อมต่อใหม่'
        );
      }, 15000);
    },
    [clearSubmitGuard]
  );

  const applyRoomSnapshot = useCallback(
    (snapshot: RoomSnapshot, isHostRole?: boolean) => {
      clearSubmitGuard();
      pendingRoomActionRef.current = null;
      setClockOffsetMs(snapshot.serverNow - Date.now());
      activeRoomCodeRef.current = snapshot.roomCode;
      safeWriteSession(ACTIVE_ROOM_KEY, snapshot.roomCode);
      if (typeof isHostRole === 'boolean') {
        safeWriteSession(ACTIVE_ROLE_KEY, isHostRole ? 'host' : 'guest');
      } else {
        const me = snapshot.players.find((p) => p.clientId === clientId);
        if (me) {
          safeWriteSession(ACTIVE_ROLE_KEY, me.isHost ? 'host' : 'guest');
        }
      }
      setRoom(snapshot);
      setStatus('connected');
      setIsSubmitting(false);
      setErrorMessage(null);
    },
    [clearSubmitGuard, clientId]
  );

  const clearRoomSession = useCallback(() => {
    clearSubmitGuard();
    pendingRoomActionRef.current = null;
    activeRoomCodeRef.current = null;
    safeWriteSession(ACTIVE_ROOM_KEY, null);
    safeWriteSession(ACTIVE_ROLE_KEY, null);
    setRoom(null);
    setIsSubmitting(false);
  }, [clearSubmitGuard]);

  const handleServerPayload = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === 'room:state') {
        applyRoomSnapshot(msg.room);
      } else if (msg.type === 'room:left') {
        clearRoomSession();
      } else if (msg.type === 'room:reaction') {
        setReactions((prev) => [...prev.slice(-8), msg.reaction]);
      } else if (msg.type === 'error') {
        clearSubmitGuard();
        pendingRoomActionRef.current = null;
        setIsSubmitting(false);
        if (msg.code === 'ROOM_EXPIRED' || msg.code === 'SESSION_MISSING') {
          clearRoomSession();
        }
        setErrorMessage(msg.message);
      }
    },
    [applyRoomSnapshot, clearRoomSession, clearSubmitGuard]
  );

  const cleanupPeerProbe = useCallback(() => {
    if (signalingProbeTimerRef.current) {
      clearTimeout(signalingProbeTimerRef.current);
      signalingProbeTimerRef.current = null;
    }
    if (peerProbeRef.current) {
      peerProbeRef.current.removeAllListeners();
      peerProbeRef.current.destroy();
      peerProbeRef.current = null;
    }
  }, []);

  const cleanupPeerResources = useCallback(() => {
    if (peerHostRef.current) {
      peerHostRef.current.destroy();
      peerHostRef.current = null;
    }
    if (peerConnRef.current) {
      peerConnRef.current.removeAllListeners();
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (peerClientRef.current) {
      peerClientRef.current.removeAllListeners();
      peerClientRef.current.destroy();
      peerClientRef.current = null;
    }
  }, []);

  const detachAndCloseWs = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    wsRef.current = null;
  }, []);

  const startPeerHostRoom = useCallback(
    (
      playerName: string,
      color: AvatarColor,
      quiz: QuizDeck,
      settings?: Partial<RoomSettings>
    ) => {
      const attemptId = ++attemptIdRef.current;
      cleanupPeerProbe();
      setErrorMessage(null);
      setIsSubmitting(true);
      startSubmitGuard(attemptId);
      cleanupPeerResources();

      const host = new PeerRoomHost(
        clientId,
        playerName,
        color,
        quiz,
        settings,
        {
          onState: (snapshot) => {
            if (attemptId !== attemptIdRef.current) return;
            applyRoomSnapshot(snapshot, true);
          },
          onReaction: (reaction) => {
            if (attemptId !== attemptIdRef.current) return;
            setReactions((prev) => [...prev.slice(-8), reaction]);
          },
          onError: (message) => {
            if (attemptId !== attemptIdRef.current) return;
            clearSubmitGuard();
            setErrorMessage(message);
            setIsSubmitting(false);
          },
        }
      );
      peerHostRef.current = host;
      host.start().catch((err) => {
        if (attemptId !== attemptIdRef.current) return;
        clearSubmitGuard();
        peerHostRef.current = null;
        setIsSubmitting(false);
        if (err instanceof PeerSignalingError && err.code === 'SIGNALING_TIMEOUT') {
          setStatus('timed_out');
        }
        setErrorMessage(
          err instanceof Error ? err.message : 'ไม่สามารถเปิดห้องได้ กรุณาลองใหม่'
        );
      });
    },
    [
      applyRoomSnapshot,
      cleanupPeerProbe,
      cleanupPeerResources,
      clearSubmitGuard,
      clientId,
      startSubmitGuard,
    ]
  );

  const startPeerJoinRoom = useCallback(
    (
      roomCode: string,
      playerName: string,
      color: AvatarColor,
      isReconnect = false
    ) => {
      const cleanCode = roomCode.trim().toUpperCase();
      const attemptId = ++attemptIdRef.current;
      cleanupPeerProbe();
      setErrorMessage(null);
      setIsSubmitting(true);
      startSubmitGuard(attemptId);

      let signalingAttempt = 0;

      const tryConnectPeer = () => {
        if (attemptId !== attemptIdRef.current) return;
        signalingAttempt += 1;
        cleanupPeerResources();

        const peer = new Peer(PEER_CONFIG);
        peerClientRef.current = peer;
        let signalingOpened = false;
        let joined = false;
        let lookupTimer: ReturnType<typeof setTimeout> | null = null;

        const clearAllTimers = () => {
          clearTimeout(signalingTimer);
          if (lookupTimer) {
            clearTimeout(lookupTimer);
            lookupTimer = null;
          }
        };

        const signalingTimer = setTimeout(() => {
          if (attemptId !== attemptIdRef.current || signalingOpened) return;
          cleanupPeerResources();
          if (signalingAttempt < PEER_SIGNALING_MAX_RETRIES) {
            setStatus('reconnecting');
            setTimeout(tryConnectPeer, 750);
            return;
          }
          clearSubmitGuard();
          setIsSubmitting(false);
          if (isReconnect) {
            clearRoomSession();
          }
          setStatus('timed_out');
          setErrorMessage(
            'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out) กรุณากดลองเชื่อมต่อใหม่'
          );
        }, PEER_SIGNALING_TIMEOUT_MS);

        peer.on('open', () => {
          if (attemptId !== attemptIdRef.current) return;
          signalingOpened = true;
          clearTimeout(signalingTimer);
          setStatus('connected');

          lookupTimer = setTimeout(() => {
            if (attemptId !== attemptIdRef.current || joined) return;
            cleanupPeerResources();
            clearSubmitGuard();
            setIsSubmitting(false);
            if (isReconnect) {
              clearRoomSession();
            } else {
              setErrorMessage(
                `ไม่พบห้องรหัส "${cleanCode}" หรือผู้คุมห้องปิดหน้าจอไปแล้ว`
              );
            }
          }, PEER_LOOKUP_TIMEOUT_MS);

          const conn = peer.connect(peerIdForRoom(cleanCode), {
            reliable: true,
            serialization: 'json',
          });
          peerConnRef.current = conn;

          conn.on('open', () => {
            if (attemptId !== attemptIdRef.current) return;
            const payload: ClientMessage = isReconnect
              ? {
                  type: 'room:reconnect',
                  clientId,
                  roomCode: cleanCode,
                }
              : {
                  type: 'room:join',
                  clientId,
                  roomCode: cleanCode,
                  playerName,
                  color,
                };
            conn.send(JSON.stringify(payload));
          });

          conn.on('data', (raw) => {
            if (attemptId !== attemptIdRef.current) return;
            let msg: ServerMessage;
            try {
              msg =
                typeof raw === 'string'
                  ? (JSON.parse(raw) as ServerMessage)
                  : (raw as ServerMessage);
            } catch {
              return;
            }
            if (msg.type === 'room:state') {
              joined = true;
              clearAllTimers();
            } else if (msg.type === 'error') {
              clearAllTimers();
            }
            handleServerPayload(msg);
          });

          conn.on('error', () => {
            if (attemptId !== attemptIdRef.current) return;
            clearAllTimers();
            cleanupPeerResources();
            clearSubmitGuard();
            setIsSubmitting(false);
            if (isReconnect) {
              clearRoomSession();
            } else {
              setErrorMessage('ไม่สามารถเชื่อมต่อกับผู้คุมห้องได้ กรุณาลองใหม่อีกครั้ง');
            }
          });

          conn.on('close', () => {
            if (attemptId !== attemptIdRef.current) return;
            if (!joined) {
              clearAllTimers();
              cleanupPeerResources();
              clearSubmitGuard();
              setIsSubmitting(false);
              if (isReconnect) {
                clearRoomSession();
              } else {
                setErrorMessage(
                  `ไม่สามารถเข้าห้อง "${cleanCode}" ได้ กรุณาตรวจสอบรหัสห้อง`
                );
              }
              return;
            }
            setErrorMessage('ผู้คุมห้องปิดห้องหรือการเชื่อมต่อสิ้นสุดลง');
          });
        });

        peer.on('error', (err: { type?: string }) => {
          if (attemptId !== attemptIdRef.current) return;
          clearAllTimers();
          cleanupPeerResources();

          if (
            !signalingOpened &&
            (err.type === 'network' ||
              err.type === 'server-error' ||
              err.type === 'socket-error' ||
              err.type === 'socket-closed') &&
            signalingAttempt < PEER_SIGNALING_MAX_RETRIES
          ) {
            setStatus('reconnecting');
            setTimeout(tryConnectPeer, 750);
            return;
          }

          clearSubmitGuard();
          setIsSubmitting(false);
          if (isReconnect) {
            clearRoomSession();
            return;
          }
          if (err.type === 'peer-unavailable') {
            setErrorMessage(
              `ไม่พบห้องรหัส "${cleanCode}" กรุณาตรวจสอบรหัสกับผู้คุมห้อง`
            );
          } else if (!signalingOpened) {
            setStatus('timed_out');
            setErrorMessage(
              'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out) กรุณาลองเชื่อมต่อใหม่'
            );
          } else {
            setErrorMessage('ไม่สามารถเชื่อมต่อเข้าห้องได้ กรุณาลองใหม่อีกครั้ง');
          }
        });
      };

      tryConnectPeer();
    },
    [
      cleanupPeerProbe,
      cleanupPeerResources,
      clearRoomSession,
      clearSubmitGuard,
      clientId,
      handleServerPayload,
      startSubmitGuard,
    ]
  );

  const probePeerSignaling = useCallback(() => {
    const probeId = ++probeAttemptRef.current;
    cleanupPeerProbe();
    setStatus('connecting');

    let attempt = 0;

    const runProbe = () => {
      if (probeId !== probeAttemptRef.current) return;
      attempt += 1;
      const probe = new Peer(PEER_CONFIG);
      peerProbeRef.current = probe;
      let done = false;

      signalingProbeTimerRef.current = setTimeout(() => {
        if (done || probeId !== probeAttemptRef.current) return;
        done = true;
        cleanupPeerProbe();
        if (attempt < PEER_SIGNALING_MAX_RETRIES) {
          setStatus('reconnecting');
          signalingProbeTimerRef.current = setTimeout(runProbe, 750);
          return;
        }
        setStatus('timed_out');
        setErrorMessage(
          'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out) กรุณากดลองเชื่อมต่อใหม่'
        );
      }, PEER_SIGNALING_TIMEOUT_MS);

      probe.on('open', () => {
        if (done || probeId !== probeAttemptRef.current) return;
        done = true;
        cleanupPeerProbe();
        setStatus('connected');
        setErrorMessage(null);
      });

      probe.on('error', () => {
        if (done || probeId !== probeAttemptRef.current) return;
        done = true;
        cleanupPeerProbe();
        if (attempt < PEER_SIGNALING_MAX_RETRIES) {
          setStatus('reconnecting');
          signalingProbeTimerRef.current = setTimeout(runProbe, 750);
          return;
        }
        setStatus('timed_out');
        setErrorMessage(
          'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out) กรุณากดลองเชื่อมต่อใหม่'
        );
      });
    };

    runProbe();
  }, [cleanupPeerProbe]);

  const flushWsQueue = useCallback((ws: WebSocket) => {
    while (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
      const next = pendingQueueRef.current.shift();
      if (next) ws.send(JSON.stringify(next));
    }
  }, []);

  const activatePeerMode = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    detachAndCloseWs();
    pendingQueueRef.current = [];
    setTransport('peer');

    const pending = pendingRoomActionRef.current;
    if (pending) {
      pendingRoomActionRef.current = null;
      if (pending.kind === 'create') {
        startPeerHostRoom(
          pending.playerName,
          pending.color,
          pending.quiz,
          pending.settings
        );
      } else {
        startPeerJoinRoom(pending.roomCode, pending.playerName, pending.color);
      }
      return;
    }

    const savedRoom = activeRoomCodeRef.current;
    const savedRole = safeReadSession(ACTIVE_ROLE_KEY);
    if (savedRoom && savedRole === 'guest') {
      startPeerJoinRoom(savedRoom, '', 'indigo', true);
      return;
    }
    if (savedRoom && savedRole === 'host') {
      clearRoomSession();
    }

    probePeerSignaling();
  }, [
    clearRoomSession,
    detachAndCloseWs,
    probePeerSignaling,
    setTransport,
    startPeerHostRoom,
    startPeerJoinRoom,
  ]);

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

    const handshakeTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) return;
      if (!hasEverOpenedWsRef.current) {
        activatePeerMode();
        return;
      }
      detachAndCloseWs();
      if (wsRetriesRef.current < WS_MAX_RETRIES) {
        wsRetriesRef.current += 1;
        setStatus('reconnecting');
        const delayMs = 1200 + wsRetriesRef.current * 500;
        reconnectTimerRef.current = setTimeout(connectWebSocket, delayMs);
      } else {
        clearSubmitGuard();
        setIsSubmitting(false);
        setStatus('timed_out');
        setErrorMessage(
          'การเชื่อมต่อเซิร์ฟเวอร์หมดเวลา (Connection timed out) กรุณากดลองเชื่อมต่อใหม่'
        );
      }
    }, WS_HANDSHAKE_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(handshakeTimeout);
      hasEverOpenedWsRef.current = true;
      wsRetriesRef.current = 0;
      setTransport('ws');
      setStatus('connected');
      setErrorMessage(null);

      const pending = pendingRoomActionRef.current;
      if (pending) {
        pendingRoomActionRef.current = null;
        if (pending.kind === 'create') {
          ws.send(
            JSON.stringify({
              type: 'room:create',
              clientId,
              playerName: pending.playerName,
              color: pending.color,
              quiz: pending.quiz,
              settings: pending.settings,
            } satisfies ClientMessage)
          );
        } else {
          ws.send(
            JSON.stringify({
              type: 'room:join',
              clientId,
              roomCode: pending.roomCode,
              playerName: pending.playerName,
              color: pending.color,
            } satisfies ClientMessage)
          );
        }
      } else if (activeRoomCodeRef.current && pendingQueueRef.current.length === 0) {
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
      clearTimeout(handshakeTimeout);
      wsRef.current = null;
      if (!hasEverOpenedWsRef.current) {
        activatePeerMode();
        return;
      }
      if (wsRetriesRef.current >= WS_MAX_RETRIES) {
        clearSubmitGuard();
        setIsSubmitting(false);
        setStatus('timed_out');
        setErrorMessage(
          'การเชื่อมต่อเซิร์ฟเวอร์หมดเวลา (Connection timed out) กรุณากดลองเชื่อมต่อใหม่'
        );
        return;
      }
      wsRetriesRef.current += 1;
      setStatus('reconnecting');
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const delayMs = 1200 + wsRetriesRef.current * 500;
      reconnectTimerRef.current = setTimeout(() => {
        connectWebSocket();
      }, delayMs);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [
    activatePeerMode,
    clearSubmitGuard,
    clientId,
    detachAndCloseWs,
    flushWsQueue,
    handleServerPayload,
    setTransport,
  ]);

  const initializeTransport = useCallback(() => {
    setErrorMessage(null);
    setStatus('connecting');
    wsRetriesRef.current = 0;

    detectWsBackend().then((hasWs) => {
      if (hasWs) {
        setTransport('ws');
        connectWebSocket();
      } else {
        activatePeerMode();
      }
    });
  }, [activatePeerMode, connectWebSocket, setTransport]);

  const retryConnection = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    clearSubmitGuard();
    detachAndCloseWs();
    cleanupPeerProbe();
    setIsSubmitting(false);
    setErrorMessage(null);
    wsRetriesRef.current = 0;

    if (transportModeRef.current === 'ws') {
      setStatus('connecting');
      connectWebSocket();
      return;
    }
    if (transportModeRef.current === 'peer') {
      probePeerSignaling();
      return;
    }
    initializeTransport();
  }, [
    cleanupPeerProbe,
    clearSubmitGuard,
    connectWebSocket,
    detachAndCloseWs,
    initializeTransport,
    probePeerSignaling,
  ]);

  useEffect(() => {
    let cancelled = false;
    detectWsBackend().then((hasWs) => {
      if (cancelled) return;
      if (hasWs) {
        setTransport('ws');
        connectWebSocket();
      } else {
        activatePeerMode();
      }
    });

    return () => {
      cancelled = true;
      probeAttemptRef.current += 1;
      attemptIdRef.current += 1;
      clearSubmitGuard();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      detachAndCloseWs();
      cleanupPeerProbe();
      cleanupPeerResources();
    };
  }, [
    activatePeerMode,
    cleanupPeerProbe,
    cleanupPeerResources,
    clearSubmitGuard,
    connectWebSocket,
    detachAndCloseWs,
    setTransport,
  ]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      if (transportModeRef.current === 'peer') {
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
    [connectWebSocket]
  );

  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 3200;
      setReactions((prev) => prev.filter((r) => r.createdAt > cutoff));
    }, 3300);
    return () => clearTimeout(timer);
  }, [reactions]);

  const createRoom = useCallback(
    (
      playerName: string,
      color: AvatarColor,
      quiz: QuizDeck,
      settings?: Partial<RoomSettings>
    ) => {
      setErrorMessage(null);
      const mode = transportModeRef.current;

      if (mode === 'peer') {
        startPeerHostRoom(playerName, color, quiz, settings);
        return;
      }

      const attemptId = ++attemptIdRef.current;
      setIsSubmitting(true);
      startSubmitGuard(attemptId);

      const ws = wsRef.current;
      if (mode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
        pendingRoomActionRef.current = null;
        ws.send(
          JSON.stringify({
            type: 'room:create',
            clientId,
            playerName,
            color,
            quiz,
            settings,
          } satisfies ClientMessage)
        );
        return;
      }

      pendingRoomActionRef.current = {
        kind: 'create',
        playerName,
        color,
        quiz,
        settings,
      };
      if (mode === 'ws') {
        connectWebSocket();
      }
    },
    [clientId, connectWebSocket, startPeerHostRoom, startSubmitGuard]
  );

  const joinRoom = useCallback(
    (roomCode: string, playerName: string, color: AvatarColor) => {
      const cleanCode = roomCode.trim().toUpperCase();
      setErrorMessage(null);
      const mode = transportModeRef.current;

      if (mode === 'peer') {
        startPeerJoinRoom(cleanCode, playerName, color, false);
        return;
      }

      const attemptId = ++attemptIdRef.current;
      setIsSubmitting(true);
      startSubmitGuard(attemptId);

      const ws = wsRef.current;
      if (mode === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
        pendingRoomActionRef.current = null;
        ws.send(
          JSON.stringify({
            type: 'room:join',
            clientId,
            roomCode: cleanCode,
            playerName,
            color,
          } satisfies ClientMessage)
        );
        return;
      }

      pendingRoomActionRef.current = {
        kind: 'join',
        roomCode: cleanCode,
        playerName,
        color,
      };
      if (mode === 'ws') {
        connectWebSocket();
      }
    },
    [clientId, connectWebSocket, startPeerJoinRoom, startSubmitGuard]
  );

  const leaveRoom = useCallback(() => {
    attemptIdRef.current += 1;
    clearRoomSession();

    if (transportModeRef.current === 'peer') {
      if (peerConnRef.current && peerConnRef.current.open) {
        peerConnRef.current.send(
          JSON.stringify({ type: 'room:leave' } satisfies ClientMessage)
        );
      }
      cleanupPeerResources();
      return;
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'room:leave' } satisfies ClientMessage));
    }
    pendingQueueRef.current = [];
  }, [cleanupPeerResources, clearRoomSession]);

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

  const restartGame = useCallback(
    (quiz?: QuizDeck) => {
      sendMessage({ type: 'host:restart_game', ...(quiz ? { quiz } : {}) });
    },
    [sendMessage]
  );

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
    retryConnection,
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
