import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Compass,
  Gamepad2,
  Heart,
  Layers,
  Plus,
  Rocket,
  Shield,
  Shuffle,
  Star,
  Timer,
  Users,
  Zap,
} from 'lucide-react';
import type { AvatarColor, QuizDeck } from '../types/quiz.ts';
import type { ConnectionStatus, TransportMode } from '../hooks/useQuizSocket.ts';
import { AVATAR_COLOR_LIST, AVATAR_STYLES, type AvatarEmblem } from '../utils/avatars.ts';

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

interface HomeViewProps {
  initialMode: 'join' | 'create';
  navCounter: number;
  initialRoomCode: string;
  playerName: string;
  playerColor: AvatarColor;
  allDecks: QuizDeck[];
  connectionStatus: ConnectionStatus;
  transportMode: TransportMode;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClearError: () => void;
  onRetryConnection: () => void;
  onUpdateProfile: (name: string, color: AvatarColor) => void;
  onRollDeck: (deckId: string) => QuizDeck | null;
  onRollAllDecks: () => void;
  onJoinRoom: (roomCode: string, playerName: string, color: AvatarColor) => void;
  onCreateRoom: (
    playerName: string,
    color: AvatarColor,
    deck: QuizDeck,
    hostPlays: boolean
  ) => void;
  onOpenBuilder: () => void;
}

export function HomeView({
  initialMode,
  navCounter,
  initialRoomCode,
  playerName,
  playerColor,
  allDecks,
  connectionStatus,
  transportMode,
  isSubmitting,
  errorMessage,
  onClearError,
  onRetryConnection,
  onUpdateProfile,
  onRollDeck,
  onRollAllDecks,
  onJoinRoom,
  onCreateRoom,
  onOpenBuilder,
}: HomeViewProps) {
  const [mode, setMode] = useState<'join' | 'create'>(
    initialRoomCode ? 'join' : initialMode
  );
  const [roomCode, setRoomCode] = useState<string>(initialRoomCode);
  const [selectedDeckId, setSelectedDeckId] = useState<string>(allDecks[0]?.id ?? '');
  const [hostPlays, setHostPlays] = useState<boolean>(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [rollNotice, setRollNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialRoomCode) {
      setMode('join');
      setRoomCode(initialRoomCode);
    } else {
      setMode(initialMode);
    }
  }, [initialMode, initialRoomCode, navCounter]);

  useEffect(() => {
    if (!allDecks.some((d) => d.id === selectedDeckId) && allDecks.length > 0) {
      setSelectedDeckId(allDecks[0].id);
    }
  }, [allDecks, selectedDeckId]);

  const selectedDeck = allDecks.find((d) => d.id === selectedDeckId) ?? allDecks[0];

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onClearError();
    const cleanCode = roomCode.trim().toUpperCase();
    const cleanName = playerName.trim();
    if (!cleanName) {
      setLocalError('กรุณาตั้งชื่อเล่นของคุณก่อนเข้าห้อง');
      return;
    }
    if (cleanCode.length < 4) {
      setLocalError('กรุณากรอกรหัสห้องให้ครบถ้วน');
      return;
    }
    setLocalError(null);
    onJoinRoom(cleanCode, cleanName, playerColor);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onClearError();
    const cleanName = playerName.trim();
    if (!cleanName) {
      setLocalError('กรุณาตั้งชื่อเล่นผู้คุมห้องก่อนเปิดห้อง');
      return;
    }
    if (!selectedDeck) {
      setLocalError('กรุณาเลือกชุดคำถาม');
      return;
    }
    setLocalError(null);
    onCreateRoom(cleanName, playerColor, selectedDeck, hostPlays);
  };

  const displayError = localError || errorMessage;
  const currentAvatar = AVATAR_STYLES[playerColor];

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-8 lg:py-12">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        {/* Left column: Hero Headline + Room Action Workspace */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/85 p-7 shadow-2xl backdrop-blur-md sm:p-9"
        >
          <div>
            <p className="text-sm font-semibold text-indigo-300">
              เล่นพร้อมกันแบบเรียลไทม์ · ไม่ต้องสมัครสมาชิก · รองรับมือถือและคอมพิวเตอร์
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[42px] lg:leading-[1.16] [text-wrap:balance]">
              เปิดห้องควิซออนไลน์ ดวลความรู้กับเพื่อนพร้อมกันทันที
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">
              สร้างห้องรับรหัส 6 หลักหรือสแกน QR Code เพื่อเข้าแข่งพร้อมกัน ตอบไวได้คะแนนโบนัส
              ลุ้นตารางอันดับสดทุกข้อ
            </p>
          </div>

          <div className="mt-8 border-t border-slate-800/90 pt-7">
            {/* Segmented Mode Control */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-800 bg-slate-950/90 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setMode('join');
                  setLocalError(null);
                  onClearError();
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
                  mode === 'join'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                เข้าห้องด้วยรหัส
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setLocalError(null);
                  onClearError();
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
                  mode === 'create'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                สร้างห้องเล่นใหม่
              </button>
            </div>

            {/* Player Profile Row */}
            <div className="mt-6 space-y-4">
              <div className="flex items-end gap-3">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-md transition-colors ${currentAvatar.bg} ${currentAvatar.text}`}
                  aria-hidden="true"
                >
                  {renderAvatarEmblem(currentAvatar.emblem, 'h-5 w-5')}
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="player-name-input"
                    className="block text-sm font-semibold text-slate-200"
                  >
                    ชื่อเล่นของคุณ
                  </label>
                  <input
                    id="player-name-input"
                    type="text"
                    maxLength={24}
                    value={playerName}
                    onChange={(e) => {
                      setLocalError(null);
                      onUpdateProfile(e.target.value, playerColor);
                    }}
                    placeholder="เช่น ต้นกล้า, แพรว, ทีมสีส้ม"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/90 px-4 py-2.5 text-base text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-300">
                  เลือกตัวละครและสีประจำตัว
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  {AVATAR_COLOR_LIST.map((colorKey) => {
                    const style = AVATAR_STYLES[colorKey];
                    const selected = playerColor === colorKey;
                    return (
                      <button
                        key={colorKey}
                        type="button"
                        aria-label={`เลือกสี${style.label}`}
                        onClick={() => onUpdateProfile(playerName, colorKey)}
                        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-150 ${
                          style.bg
                        } ${style.text} ${
                          selected
                            ? `ring-2 ${style.ring} ring-offset-2 ring-offset-slate-900 scale-105`
                            : 'opacity-65 hover:opacity-100 hover:scale-105'
                        }`}
                      >
                        {renderAvatarEmblem(style.emblem, 'h-4 w-4')}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {(displayError || connectionStatus === 'timed_out') && (
              <div
                role="alert"
                className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
              >
                <span>
                  {displayError ||
                    'การเชื่อมต่อเซิร์ฟเวอร์สัญญาณหมดเวลา (Connection timed out)'}
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

            {mode === 'join' ? (
              <form onSubmit={handleJoinSubmit} className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="room-code-input"
                    className="block text-sm font-semibold text-slate-200"
                  >
                    รหัสห้อง (6 ตัวอักษร)
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    maxLength={8}
                    value={roomCode}
                    onChange={(e) => {
                      setLocalError(null);
                      onClearError();
                      setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                    }}
                    placeholder="เช่น K94M2P"
                    className="font-mono-tabular mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-xl font-bold tracking-[0.2em] text-white uppercase placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <button
                  type="submit"
                  disabled={connectionStatus !== 'connected' || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-b-4 border-indigo-800 bg-indigo-600 px-6 py-3.5 text-base font-extrabold text-white transition-all hover:bg-indigo-500 active:translate-y-0.5 active:border-b-2 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'กำลังเข้าร่วมห้อง...' : 'เข้าร่วมห้องเลย'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreateSubmit} className="mt-5 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      ผู้สร้างห้องร่วมเล่นตอบคำถามด้วย
                    </p>
                    <p className="text-xs text-slate-400">
                      ปิดได้หากต้องการใช้หน้าจอนี้เป็นจอหลักขึ้นโปรเจกเตอร์อย่างเดียว
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hostPlays}
                    onClick={() => setHostPlays((prev) => !prev)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                      hostPlays ? 'bg-indigo-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        hostPlays ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-slate-400">ชุดคำถามที่เลือก: </span>
                      <span className="font-bold text-white">{selectedDeck?.title}</span>
                      <span className="text-slate-400 tabular-nums">
                        {' '}
                        · {selectedDeck?.questions.length} ข้อ
                      </span>
                    </div>
                    {selectedDeck && (
                      <button
                        type="button"
                        onClick={() => {
                          onRollDeck(selectedDeck.id);
                          setRollNotice(`สุ่มชุดคำถามใหม่ในหมวด "${selectedDeck.title}" แล้ว`);
                          setTimeout(() => setRollNotice(null), 2400);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
                      >
                        <Shuffle className="h-3 w-3" />
                        <span>รันคำถามใหม่</span>
                      </button>
                    )}
                  </div>
                  {selectedDeck?.questions[0] && (
                    <p className="mt-1.5 truncate text-xs text-slate-400">
                      ข้อแรก: {selectedDeck.questions[0].prompt}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={connectionStatus !== 'connected' || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-b-4 border-indigo-800 bg-indigo-600 px-6 py-3.5 text-base font-extrabold text-white transition-all hover:bg-indigo-500 active:translate-y-0.5 active:border-b-2 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'กำลังเปิดห้อง...' : 'เปิดห้องและรับรหัสห้อง'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </motion.section>

        {/* Right column: Curated Quiz Decks Selector with visual thumbnails */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/85 p-7 shadow-2xl backdrop-blur-md sm:p-9"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-white">
                  คลังชุดคำถาม ({allDecks.length} หมวด)
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {rollNotice || 'ทุกหมวดมี 10 คำถาม พร้อมปุ่มรันชุดคำถามใหม่ได้ตลอด'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onRollAllDecks();
                    setRollNotice('รันคำถามใหม่ทุกหมวดเรียบร้อยแล้ว');
                    setTimeout(() => setRollNotice(null), 2400);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-950/60 px-3 py-2 text-xs font-bold text-indigo-200 transition-colors hover:bg-indigo-900/70 hover:text-white whitespace-nowrap shrink-0"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  <span>รันคำถามใหม่ทุกหมวด</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenBuilder}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>สร้างควิซเอง</span>
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {allDecks.map((deck) => {
                const isSelected = deck.id === selectedDeck?.id;
                const coverUrl = deck.questions.find((q) => Boolean(q.imageUrl))?.imageUrl;

                return (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() => {
                      setSelectedDeckId(deck.id);
                      setMode('create');
                      setLocalError(null);
                    }}
                    className={`group flex w-full items-center gap-4 rounded-xl border p-3.5 text-left transition-all duration-150 ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/45 shadow-md'
                        : 'border-slate-800 bg-slate-950/65 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={deck.title}
                        referrerPolicy="no-referrer"
                        className="h-16 w-20 shrink-0 rounded-lg object-cover border border-slate-800"
                      />
                    ) : (
                      <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-gradient-to-br from-slate-800 to-slate-900 text-indigo-300">
                        <Gamepad2 className="h-6 w-6" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="truncate text-base font-bold text-white">
                          {deck.title}
                        </h3>
                        <span
                          className={`mt-0.5 text-xs font-bold whitespace-nowrap shrink-0 ${
                            isSelected
                              ? 'text-indigo-300'
                              : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          {isSelected ? 'กำลังเลือก' : 'เลือกเล่น'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {deck.category}
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">{deck.questions.length} ข้อ</span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">
                          ข้อละ {deck.defaultTimeLimitSec} วินาที
                        </span>
                        {deck.isCustom ? ' · สร้างเอง' : ''}
                      </p>
                      {deck.description && (
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-300 line-clamp-1">
                          {deck.description}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
            <span>สถานะการเชื่อมต่อระบบห้อง</span>
            <div className="flex items-center gap-3">
              <span
                className={`font-medium ${
                  connectionStatus === 'timed_out'
                    ? 'text-rose-300'
                    : connectionStatus === 'connected'
                    ? 'text-emerald-300'
                    : 'text-slate-200'
                }`}
              >
                {connectionStatus === 'connected'
                  ? transportMode === 'peer'
                    ? 'พร้อมใช้งาน (โหมดออนไลน์ Peer-to-Peer)'
                    : 'พร้อมใช้งาน (เชื่อมต่อเซิร์ฟเวอร์เรียลไทม์แล้ว)'
                  : connectionStatus === 'timed_out'
                  ? 'หมดเวลาการเชื่อมต่อ (Connection timed out)'
                  : connectionStatus === 'reconnecting'
                  ? 'กำลังลองเชื่อมต่อใหม่...'
                  : 'กำลังตรวจสอบการเชื่อมต่อ...'}
              </span>
              {connectionStatus === 'timed_out' && (
                <button
                  type="button"
                  onClick={onRetryConnection}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  เชื่อมต่อใหม่
                </button>
              )}
            </div>
          </div>
        </motion.section>
      </div>

      {/* 4-column Feature Strip below Hero Split */}
      <section className="mt-10 grid grid-cols-1 gap-6 border-t border-slate-800/80 pt-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="h-4 w-4 text-indigo-400" />
            <span>ซิงก์ห้องเดียวกันแบบสด</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ทุกคนเห็นคำถาม รูปภาพ และเวลานับถอยหลังพร้อมกันทุกเครื่องแบบเรียลไทม์
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Zap className="h-4 w-4 text-amber-400" />
            <span>คะแนนตามความไวและสตรีค</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ตอบถูกและเร็วรับสูงสุด 1,000 คะแนน พร้อมโบนัสตอบถูกต่อเนื่องสูงสุด 500 คะแนน
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Timer className="h-4 w-4 text-emerald-400" />
            <span>เสียงนับถอยหลังเร้าใจ</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            มาพร้อมเสียงจังหวะนับถอยหลัง เสียงตอบถูก/ผิด และปุ่มปิดเสียงได้ตามต้องการ
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Layers className="h-4 w-4 text-sky-400" />
            <span>สร้างข้อสอบพร้อมรูปภาพ</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            แต่งคำถาม 2–4 ตัวเลือก อัปโหลดรูปประกอบ และบันทึกเก็บไว้เปิดห้องเล่นซ้ำได้ทันที
          </p>
        </div>
      </section>
    </main>
  );
}
