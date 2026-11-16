import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  Award,
  Check,
  Compass,
  Copy,
  Heart,
  ImageOff,
  Link2,
  Play,
  Rocket,
  RotateCcw,
  Shield,
  Star,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  ZoomIn,
} from 'lucide-react';
import type { ConnectionStatus } from '../hooks/useQuizSocket.ts';
import type {
  QuizDeck,
  ReactionBurst,
  RoomSettings,
  RoomSnapshot,
} from '../types/quiz.ts';
import { AVATAR_STYLES, OPTION_THEMES, type AvatarEmblem } from '../utils/avatars.ts';
import { soundEngine } from '../utils/sound.ts';

function renderAvatarEmblem(emblem: AvatarEmblem, className = 'h-4 w-4') {
  switch (emblem) {
    case 'zap':
      return <Zap className={className} />;
    case 'heart':
      return <Heart className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'star':
      return <Star className={className} />;
    case 'rocket':
      return <Rocket className={className} />;
    case 'shield':
      return <Shield className={className} />;
  }
}

interface RoomArenaProps {
  clientId: string;
  room: RoomSnapshot;
  clockOffsetMs: number;
  allDecks: QuizDeck[];
  reactions: ReactionBurst[];
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;
  onRetryConnection: () => void;
  onUpdateSettings: (settings: Partial<RoomSettings>) => void;
  onChangeQuiz: (deck: QuizDeck) => void;
  onStartGame: () => void;
  onSubmitAnswer: (optionIndex: number) => void;
  onEndQuestion: () => void;
  onNextStep: () => void;
  onRestartGame: () => void;
  onSendReaction: (label: string) => void;
  onLeaveRoom: () => void;
}

const QUICK_REACTIONS = ['พร้อมแล้ว', 'ลุยเลย', 'สุดยอด', 'ขออีกเกม'];

export function RoomArena({
  clientId,
  room,
  clockOffsetMs,
  allDecks,
  reactions,
  connectionStatus,
  errorMessage,
  onRetryConnection,
  onUpdateSettings,
  onChangeQuiz,
  onStartGame,
  onSubmitAnswer,
  onEndQuestion,
  onNextStep,
  onRestartGame,
  onSendReaction,
  onLeaveRoom,
}: RoomArenaProps) {
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number>(room.phaseDurationMs);
  const [optimisticOption, setOptimisticOption] = useState<number | null>(null);
  const [imageBroken, setImageBroken] = useState<boolean>(false);
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);

  const lastTickSecRef = useRef<number | null>(null);
  const lastSoundPhaseRef = useRef<string>('');

  const me = useMemo(
    () => room.players.find((p) => p.clientId === clientId) ?? null,
    [room.players, clientId]
  );
  const isHost = me?.isHost ?? false;

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/?room=${room.roomCode}`;
  }, [room.roomCode]);

  // Unlock AudioContext on first user interaction inside the arena
  useEffect(() => {
    const unlock = () => soundEngine.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Reset optimistic option and image state when moving to a new question
  useEffect(() => {
    setOptimisticOption(null);
    setImageBroken(false);
    setZoomedImageUrl(null);
    lastTickSecRef.current = null;
  }, [room.currentQuestionIndex, room.phase]);

  // High-resolution synced timer with countdown audio cues
  useEffect(() => {
    if (room.phaseDurationMs <= 0) {
      setRemainingMs(0);
      return;
    }

    const update = () => {
      const syncedNow = Date.now() + clockOffsetMs;
      const elapsed = syncedNow - room.phaseStartedAt;
      const left = Math.max(0, room.phaseDurationMs - elapsed);
      setRemainingMs(left);

      const secLeft = Math.ceil(left / 1000);
      if (room.phase === 'COUNTDOWN') {
        if (secLeft >= 1 && secLeft <= 3 && lastTickSecRef.current !== secLeft) {
          lastTickSecRef.current = secLeft;
          soundEngine.playCountdownStep(secLeft);
        }
      } else if (room.phase === 'QUESTION') {
        if (secLeft >= 1 && lastTickSecRef.current !== secLeft) {
          lastTickSecRef.current = secLeft;
          soundEngine.playTick(secLeft <= 5, secLeft);
        }
      }
    };

    update();
    const interval = setInterval(update, 50);
    return () => clearInterval(interval);
  }, [room.phase, room.phaseStartedAt, room.phaseDurationMs, clockOffsetMs]);

  // Sound & confetti cues on QUESTION start, REVEAL, and FINAL_PODIUM
  useEffect(() => {
    const phaseKey = `${room.phase}-${room.currentQuestionIndex}`;
    if (lastSoundPhaseRef.current === phaseKey) return;
    lastSoundPhaseRef.current = phaseKey;

    if (room.phase === 'QUESTION') {
      soundEngine.playQuestionStart();
    } else if (room.phase === 'REVEAL' && me?.isPlaying && room.currentQuestion) {
      if (me.selectedOption === room.currentQuestion.correctIndex) {
        soundEngine.playCorrect();
      } else {
        soundEngine.playWrong();
      }
    } else if (room.phase === 'FINAL_PODIUM') {
      soundEngine.playFanfare();
      void confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.65 },
      });
    }
  }, [room.phase, room.currentQuestionIndex, room.currentQuestion, me]);

  // Keyboard shortcuts 1-4 during QUESTION
  useEffect(() => {
    if (room.phase !== 'QUESTION' || !me?.isPlaying || me.answeredCurrent) return;
    const optionCount = room.currentQuestion?.options.length ?? 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const num = Number(e.key);
      if (num >= 1 && num <= optionCount) {
        setOptimisticOption(num - 1);
        soundEngine.playLockIn();
        onSubmitAnswer(num - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [room.phase, room.currentQuestion, me, onSubmitAnswer]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSelectOption = (idx: number) => {
    if (room.phase !== 'QUESTION' || !me?.isPlaying || me.answeredCurrent) return;
    setOptimisticOption(idx);
    soundEngine.playLockIn();
    onSubmitAnswer(idx);
  };

  const playingPlayers = room.players.filter((p) => p.isPlaying);
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const progressPct =
    room.phaseDurationMs > 0
      ? Math.max(0, Math.min(100, (remainingMs / room.phaseDurationMs) * 100))
      : 0;

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-6 sm:py-8">
      {/* Arena HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">รหัสห้อง</span>
            <span className="font-mono-tabular text-base font-bold tracking-wider text-white">
              {room.roomCode}
            </span>
            <button
              type="button"
              onClick={copyCode}
              aria-label="คัดลอกรหัสห้อง"
              className="rounded-md border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {copiedCode ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          <span className="text-slate-700" aria-hidden="true">
            ·
          </span>

          <div className="text-slate-200 font-semibold truncate max-w-[300px]">
            {room.quizTitle}
          </div>

          {room.phase !== 'LOBBY' && (
            <>
              <span className="text-slate-700" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums text-slate-300 font-medium">
                ข้อ {Math.min(room.currentQuestionIndex + 1, room.totalQuestions)} /{' '}
                {room.totalQuestions}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {me?.isPlaying && (
            <div className="text-sm font-semibold text-slate-200 tabular-nums">
              คะแนนของคุณ: <span className="text-indigo-300">{me.score.toLocaleString()}</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'เปิดเสียงเกม' : 'ปิดเสียงเกม'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>{muted ? 'ปิดเสียง' : 'เสียงเปิด'}</span>
          </button>
        </div>
      </div>

      {(errorMessage || connectionStatus === 'timed_out' || connectionStatus === 'reconnecting') && (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-200"
        >
          <span>
            {errorMessage ||
              (connectionStatus === 'timed_out'
                ? 'การเชื่อมต่อเซิร์ฟเวอร์หมดเวลา (Connection timed out)'
                : 'สัญญาณขาดหาย กำลังลองเชื่อมต่อห้องใหม่...')}
          </span>
          {connectionStatus === 'timed_out' && (
            <button
              type="button"
              onClick={onRetryConnection}
              className="rounded-lg border border-rose-400/50 bg-rose-900/60 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-800 whitespace-nowrap shrink-0"
            >
              ลองเชื่อมต่อใหม่
            </button>
          )}
        </div>
      )}

      {/* PHASE: LOBBY */}
      {room.phase === 'LOBBY' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
          {/* Invite & QR Panel */}
          <section className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8">
            <p className="text-sm font-medium text-indigo-300">
              ชวนเพื่อนเข้าห้องเดียวกัน
            </p>
            <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950 px-5 py-4">
              <div>
                <p className="text-xs text-slate-400">รหัสห้อง</p>
                <p className="font-mono-tabular mt-0.5 text-3xl font-extrabold tracking-[0.22em] text-white sm:text-4xl">
                  {room.roomCode}
                </p>
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span>คัดลอกแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>คัดลอกรหัส</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-5 flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950/80 p-5 text-center">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={inviteUrl} size={148} level="M" />
              </div>
              <p className="mt-3 text-sm text-slate-300">
                สแกน QR Code เพื่อเข้าห้องจากมือถือทันที
              </p>
              <button
                type="button"
                onClick={copyInviteLink}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>{copiedLink ? 'คัดลอกลิงก์เชิญแล้ว' : 'คัดลอกลิงก์เชิญเข้าห้อง'}</span>
              </button>
            </div>

            {isHost && (
              <div className="mt-6 space-y-4 border-t border-slate-800 pt-6">
                <div>
                  <label
                    htmlFor="lobby-deck-select"
                    className="block text-sm font-medium text-slate-200"
                  >
                    เปลี่ยนชุดคำถามในห้องนี้
                  </label>
                  <select
                    id="lobby-deck-select"
                    value={
                      allDecks.find((d) => d.title === room.quizTitle)?.id ?? ''
                    }
                    onChange={(e) => {
                      const found = allDecks.find((d) => d.id === e.target.value);
                      if (found) onChangeQuiz(found);
                    }}
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    {allDecks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.questions.length} ข้อ)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">ผู้คุมห้องร่วมตอบด้วย</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={room.settings.hostPlays}
                    onClick={() =>
                      onUpdateSettings({ hostPlays: !room.settings.hostPlays })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      room.settings.hostPlays ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        room.settings.hostPlays ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">
                    เลื่อนข้อถัดไปอัตโนมัติ
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={room.settings.autoAdvance}
                    onClick={() =>
                      onUpdateSettings({ autoAdvance: !room.settings.autoAdvance })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      room.settings.autoAdvance ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        room.settings.autoAdvance ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onStartGame}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-base font-bold text-white transition-colors hover:bg-indigo-500"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>เริ่มเกมเลย ({room.totalQuestions} ข้อ)</span>
                </button>
              </div>
            )}

            {!isHost && (
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3.5 text-center text-sm text-slate-300">
                รอผู้คุมห้องกดเริ่มเกม · เตรียมตัวให้พร้อม!
              </div>
            )}
          </section>

          {/* Live Player Roster */}
          <section className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-400" />
                  <span>ผู้เล่นในห้อง ({room.players.length} คน)</span>
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  ชุดคำถาม: {room.quizTitle} · {room.totalQuestions} ข้อ
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_REACTIONS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onSendReaction(label)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-indigo-500 hover:text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AnimatePresence initial={false}>
                {room.players.map((player) => {
                  const avatar = AVATAR_STYLES[player.color];
                  const isSelf = player.clientId === clientId;
                  return (
                    <motion.div
                      key={player.clientId}
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                        isSelf
                          ? 'border-indigo-500/70 bg-indigo-950/30'
                          : 'border-slate-800 bg-slate-950/65'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${avatar.bg} ${avatar.text}`}
                        >
                          {renderAvatarEmblem(avatar.emblem, 'h-4 w-4')}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">
                            {player.name}
                            {isSelf ? ' (คุณ)' : ''}
                          </p>
                          <p className="text-xs text-slate-400">
                            {player.isHost ? 'ผู้คุมห้อง' : 'ผู้เล่น'}
                            {player.isHost && !player.isPlaying ? ' · โหมดผู้บรรยาย' : ''}
                            {!player.connected ? ' · ขาดการเชื่อมต่อ' : ''}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </section>
        </div>
      )}

      {/* PHASE: COUNTDOWN */}
      {room.phase === 'COUNTDOWN' && (
        <motion.section
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="mx-auto mt-12 max-w-xl rounded-2xl border border-slate-800 bg-slate-900/90 p-10 text-center shadow-2xl"
        >
          <p className="text-sm font-semibold text-indigo-300 tabular-nums">
            ข้อที่ {room.currentQuestionIndex + 1} จาก {room.totalQuestions}
          </p>
          <h2 className="mt-2 text-2xl font-extrabold text-white">{room.quizTitle}</h2>
          <div className="relative mx-auto mt-8 flex h-32 w-32 items-center justify-center rounded-full border-4 border-indigo-500/30 bg-slate-950">
            <motion.span
              key={Math.max(1, secondsLeft)}
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="font-mono-tabular text-6xl font-extrabold text-white"
            >
              {Math.max(1, secondsLeft)}
            </motion.span>
          </div>
          <p className="mt-5 text-sm text-slate-400">เตรียมพร้อมอ่านคำถาม...</p>
        </motion.section>
      )}

      {/* PHASE: QUESTION & REVEAL */}
      {(room.phase === 'QUESTION' || room.phase === 'REVEAL') && room.currentQuestion && (
        <div className="mt-6 space-y-6">
          {/* Timer & Answer Progress Bar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="font-mono-tabular text-2xl font-extrabold text-white">
                  {room.phase === 'QUESTION' ? `${secondsLeft} วินาที` : 'เฉลยคำตอบ'}
                </span>
                <span className="text-sm text-slate-400 tabular-nums">
                  ตอบแล้ว {room.answeredCount} / {Math.max(1, playingPlayers.length)} คน
                </span>
              </div>

              {isHost && room.phase === 'QUESTION' && (
                <button
                  type="button"
                  onClick={onEndQuestion}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  ปิดรับคำตอบและเฉลยเลย
                </button>
              )}

              {isHost && room.phase === 'REVEAL' && (
                <button
                  type="button"
                  onClick={onNextStep}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 whitespace-nowrap shrink-0"
                >
                  <span>
                    {room.currentQuestionIndex >= room.totalQuestions - 1
                      ? 'ดูสรุปผลชนะเลิศ'
                      : 'ดูตารางอันดับ'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>

            {room.phase === 'QUESTION' && (
              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-950">
                <div
                  className={`h-full transition-all duration-75 ${
                    secondsLeft <= 4 ? 'bg-rose-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}

            <h2 className="mt-6 text-xl font-bold leading-snug text-white sm:text-2xl lg:text-3xl [text-wrap:balance]">
              {room.currentQuestion.prompt}
            </h2>

            {room.currentQuestion.imageUrl && (
              <div className="mt-5">
                {imageBroken ? (
                  <div className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 text-sm text-slate-400">
                    <ImageOff className="h-6 w-6 text-slate-500" />
                    <span>ไม่สามารถแสดงรูปภาพประกอบของข้อนี้ได้</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setZoomedImageUrl(room.currentQuestion?.imageUrl ?? null)
                    }
                    className="group relative mx-auto block w-full max-w-2xl overflow-hidden rounded-xl border border-slate-800 bg-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <img
                      src={room.currentQuestion.imageUrl}
                      alt={`ภาพประกอบคำถามข้อที่ ${room.currentQuestionIndex + 1}`}
                      referrerPolicy="no-referrer"
                      onError={() => setImageBroken(true)}
                      className="mx-auto max-h-[260px] w-full object-contain sm:max-h-[320px]"
                    />
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-lg bg-slate-950/80 px-2.5 py-1 text-xs font-medium text-slate-200 opacity-85 transition-opacity group-hover:opacity-100">
                      <ZoomIn className="h-3.5 w-3.5" />
                      <span>ขยายรูป</span>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Personal Round Feedback on REVEAL */}
          {room.phase === 'REVEAL' && me?.isPlaying && (
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${
                me.selectedOption === room.currentQuestion.correctIndex
                  ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-100'
                  : 'border-rose-500/50 bg-rose-950/40 text-rose-100'
              }`}
            >
              <div className="flex items-center gap-3">
                {me.selectedOption === room.currentQuestion.correctIndex ? (
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                ) : (
                  <X className="h-5 w-5 text-rose-400 shrink-0" />
                )}
                <div>
                  <p className="font-bold">
                    {me.selectedOption === room.currentQuestion.correctIndex
                      ? 'ถูกต้อง! เยี่ยมมาก'
                      : me.selectedOption === null
                      ? 'หมดเวลาสำหรับข้อนี้'
                      : 'ยังไม่ใช่คำตอบที่ถูก'}
                  </p>
                  {me.streak >= 2 && (
                    <p className="text-xs text-emerald-300 tabular-nums">
                      ตอบถูกต่อเนื่อง {me.streak} ข้อติด
                    </p>
                  )}
                </div>
              </div>
              <div className="font-mono-tabular text-lg font-extrabold">
                +{me.lastRoundScore.toLocaleString()} คะแนน
              </div>
            </div>
          )}

          {/* Answer Options Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {room.currentQuestion.options.map((optText, idx) => {
              const theme = OPTION_THEMES[idx % OPTION_THEMES.length];
              const isReveal = room.phase === 'REVEAL';
              const isCorrect = isReveal && room.currentQuestion?.correctIndex === idx;
              const myChoice = me?.selectedOption ?? optimisticOption;
              const isMyPick = myChoice === idx;
              const lockedOut =
                room.phase === 'QUESTION' &&
                (!me?.isPlaying || me.answeredCurrent || optimisticOption !== null);

              const count = room.optionCounts ? room.optionCounts[idx] ?? 0 : 0;
              const totalAnswers = room.optionCounts
                ? room.optionCounts.reduce((acc, n) => acc + n, 0)
                : 0;
              const barPct = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={room.phase !== 'QUESTION' || lockedOut}
                  onClick={() => handleSelectOption(idx)}
                  className={`relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-2xl border p-5 text-left transition-all duration-150 ${
                    isReveal
                      ? isCorrect
                        ? 'border-emerald-400 bg-emerald-950/65 ring-2 ring-emerald-400/70'
                        : isMyPick
                        ? 'border-rose-400/60 bg-slate-900/75 opacity-80'
                        : 'border-slate-800 bg-slate-900/50 opacity-55'
                      : isMyPick
                      ? `${theme.baseBg} ${theme.border} ${theme.bottomLip} ring-2 ring-white translate-y-[1px]`
                      : lockedOut
                      ? `${theme.baseBg} ${theme.border} ${theme.bottomLip} opacity-45 cursor-not-allowed`
                      : `${theme.baseBg} ${theme.hoverBg} ${theme.border} ${theme.bottomLip} active:translate-y-[2px]`
                  }`}
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/25 text-sm font-bold text-white">
                        {theme.symbol}
                      </span>
                      <span className="text-base font-bold leading-snug text-white sm:text-lg">
                        {optText}
                      </span>
                    </div>

                    {room.phase === 'QUESTION' && (
                      <span className="font-mono-tabular shrink-0 rounded bg-black/25 px-2 py-0.5 text-xs font-semibold text-white/80">
                        {theme.keyHint}
                      </span>
                    )}

                    {isReveal && isCorrect && (
                      <span className="inline-flex items-center gap-1 shrink-0 text-xs font-bold text-emerald-300">
                        <Check className="h-4 w-4" />
                        <span>คำตอบที่ถูก</span>
                      </span>
                    )}
                  </div>

                  {isMyPick && room.phase === 'QUESTION' && (
                    <p className="mt-3 text-xs font-semibold text-white/95">
                      ส่งคำตอบของคุณแล้ว · รอเพื่อนๆ ในห้อง...
                    </p>
                  )}

                  {isReveal && (
                    <div className="mt-4 w-full space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-slate-300 tabular-nums">
                        <span>{isMyPick ? 'คำตอบที่คุณเลือก' : 'ผู้เลือกข้อนี้'}</span>
                        <span>
                          {count} คน ({barPct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-950/90">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isCorrect ? 'bg-emerald-400' : theme.barBg
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {room.phase === 'REVEAL' && room.currentQuestion.explanation && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 px-5 py-4 text-sm leading-relaxed text-slate-200">
              <span className="font-bold text-indigo-300">สาระน่ารู้: </span>
              {room.currentQuestion.explanation}
            </div>
          )}

          {room.phase === 'QUESTION' && !me?.isPlaying && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-5 py-4 text-center text-sm text-slate-300">
              คุณกำลังอยู่ในโหมดผู้คุมห้อง (ไม่ได้ร่วมส่งคำตอบ) · ตอบแล้ว {room.answeredCount} /{' '}
              {playingPlayers.length} คน
            </div>
          )}
        </div>
      )}

      {/* PHASE: LEADERBOARD */}
      {room.phase === 'LEADERBOARD' && (
        <section className="mx-auto mt-8 max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-extrabold text-white">ตารางอันดับคะแนน</h2>
              <p className="mt-1 text-sm text-slate-400 tabular-nums">
                จบข้อที่ {room.currentQuestionIndex + 1} จาก {room.totalQuestions}
              </p>
            </div>
            {isHost && (
              <button
                type="button"
                onClick={onNextStep}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 whitespace-nowrap shrink-0"
              >
                <span>เริ่มข้อถัดไป</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-6 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60">
            {playingPlayers.map((player, index) => {
              const avatar = AVATAR_STYLES[player.color];
              const isSelf = player.clientId === clientId;
              return (
                <div
                  key={player.clientId}
                  className={`flex items-center justify-between gap-4 px-4 py-3.5 ${
                    isSelf ? 'bg-indigo-950/25' : ''
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="font-mono-tabular w-6 text-center text-sm font-bold text-slate-400">
                      #{index + 1}
                    </span>
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatar.bg} ${avatar.text}`}
                    >
                      {player.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">
                        {player.name}
                        {isSelf ? ' (คุณ)' : ''}
                      </p>
                      {player.streak >= 2 && (
                        <p className="text-xs text-amber-300 tabular-nums">
                          ตอบถูกต่อเนื่อง {player.streak} ข้อ
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tabular text-base font-bold text-white">
                      {player.score.toLocaleString()}
                    </p>
                    {player.lastRoundScore > 0 && (
                      <p className="font-mono-tabular text-xs text-emerald-400">
                        +{player.lastRoundScore.toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* PHASE: FINAL PODIUM */}
      {room.phase === 'FINAL_PODIUM' && (
        <section className="mx-auto mt-8 max-w-3xl space-y-8">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-7 sm:p-9 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <Award className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-3xl font-extrabold text-white">สรุปผลการแข่งขัน</h2>
            <p className="mt-1 text-sm text-slate-400">
              {room.quizTitle} · {room.totalQuestions} ข้อ
            </p>

            {/* Top 3 Podium Cards */}
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
              {playingPlayers.slice(0, 3).map((player, rankIdx) => {
                const avatar = AVATAR_STYLES[player.color];
                const rankLabels = ['อันดับ 1', 'อันดับ 2', 'อันดับ 3'];
                const orderClass =
                  rankIdx === 0
                    ? 'sm:order-2 sm:py-7 border-amber-400/75 bg-amber-950/30 shadow-xl'
                    : rankIdx === 1
                    ? 'sm:order-1 border-slate-700 bg-slate-950/75'
                    : 'sm:order-3 border-slate-800 bg-slate-950/65';
                return (
                  <motion.div
                    key={player.clientId}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: rankIdx * 0.08 }}
                    className={`rounded-xl border p-5 ${orderClass}`}
                  >
                    <p
                      className={`text-xs font-bold ${
                        rankIdx === 0 ? 'text-amber-300' : 'text-slate-300'
                      }`}
                    >
                      {rankLabels[rankIdx]}
                    </p>
                    <div
                      className={`mx-auto mt-3 flex h-12 w-12 items-center justify-center rounded-xl shadow-md ${avatar.bg} ${avatar.text}`}
                    >
                      {renderAvatarEmblem(avatar.emblem, 'h-5 w-5')}
                    </div>
                    <p className="mt-3 truncate text-lg font-bold text-white">
                      {player.name}
                    </p>
                    <p className="font-mono-tabular mt-1 text-2xl font-extrabold text-indigo-300">
                      {player.score.toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 tabular-nums">
                      ถูก {player.correctCount} / {room.totalQuestions} ข้อ
                    </p>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {isHost && (
                <button
                  type="button"
                  onClick={onRestartGame}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-500 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>เล่นอีกครั้ง (ห้องเดิม)</span>
                </button>
              )}
              <button
                type="button"
                onClick={onLeaveRoom}
                className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-3 text-sm font-semibold text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                ออกจากห้อง
              </button>
            </div>
          </div>

          {/* Full Standings Table */}
          {playingPlayers.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6">
              <h3 className="text-base font-bold text-white">อันดับผู้เล่นทั้งหมด</h3>
              <div className="mt-4 divide-y divide-slate-800">
                {playingPlayers.map((player, idx) => (
                  <div
                    key={player.clientId}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono-tabular w-6 text-slate-400 font-bold">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-white">{player.name}</span>
                    </div>
                    <div className="flex items-center gap-6 tabular-nums">
                      <span className="text-slate-400">
                        ถูก {player.correctCount}/{room.totalQuestions} ข้อ
                      </span>
                      <span className="font-mono-tabular font-bold text-white">
                        {player.score.toLocaleString()} คะแนน
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Lightbox Modal for Question Image */}
      {zoomedImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomedImageUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="ปิดภาพขยาย"
            onClick={() => setZoomedImageUrl(null)}
            className="absolute right-5 top-5 rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-white hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomedImageUrl}
            alt="ภาพประกอบคำถามขนาดขยาย"
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}

      {/* Ephemeral Cheer / Reaction Stream */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2"
      >
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 10, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.94 }}
              transition={{ duration: 0.18 }}
              className="rounded-xl border border-slate-700 bg-slate-900/95 px-3.5 py-2 text-xs font-semibold text-white shadow-lg"
            >
              <span className="text-indigo-300">{r.senderName}</span>
              <span className="text-slate-400"> · </span>
              <span>{r.label}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}
