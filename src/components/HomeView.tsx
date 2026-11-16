import { useEffect, useState } from 'react';
import { ArrowRight, Check, Layers, Plus, Timer, Users, Zap } from 'lucide-react';
import type { AvatarColor, QuizDeck } from '../types/quiz.ts';
import type { ConnectionStatus, TransportMode } from '../hooks/useQuizSocket.ts';
import { AVATAR_COLOR_LIST, AVATAR_STYLES } from '../utils/avatars.ts';

interface HomeViewProps {
  initialMode: 'join' | 'create';
  initialRoomCode: string;
  playerName: string;
  playerColor: AvatarColor;
  allDecks: QuizDeck[];
  connectionStatus: ConnectionStatus;
  transportMode: TransportMode;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClearError: () => void;
  onUpdateProfile: (name: string, color: AvatarColor) => void;
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
  initialRoomCode,
  playerName,
  playerColor,
  allDecks,
  connectionStatus,
  transportMode,
  isSubmitting,
  errorMessage,
  onClearError,
  onUpdateProfile,
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

  useEffect(() => {
    if (initialRoomCode) {
      setMode('join');
      setRoomCode(initialRoomCode);
    } else {
      setMode(initialMode);
    }
  }, [initialMode, initialRoomCode]);

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

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10 lg:py-14">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        {/* Left column: Hero Headline + Room Action Workspace */}
        <section className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/90 p-7 sm:p-9">
          <div>
            <p className="text-sm font-medium text-indigo-300">
              เล่นพร้อมกันแบบเรียลไทม์ · ไม่ต้องลงทะเบียน · รองรับทุกอุปกรณ์
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[42px] lg:leading-[1.16] [text-wrap:balance]">
              สร้างห้องควิซออนไลน์ แล้วดวลคำถามพร้อมกันทั้งห้อง
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">
              เปิดห้องในคลิกเดียว แชร์รหัส 6 หลักหรือสแกน QR Code ให้เพื่อนเข้าร่วมจากมือถือหรือคอมพิวเตอร์
              ตอบไวได้คะแนนสูง พร้อมตารางอันดับสดทุกข้อ
            </p>
          </div>

          <div className="mt-8 border-t border-slate-800 pt-7">
            {/* Segmented Mode Control */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('join');
                  setLocalError(null);
                  onClearError();
                }}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'join'
                    ? 'bg-indigo-600 text-white'
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
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'create'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                สร้างห้องเล่นใหม่
              </button>
            </div>

            {/* Player Profile Row */}
            <div className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="player-name-input"
                  className="block text-sm font-medium text-slate-200"
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
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-200">
                  เลือกสีประจำตัว
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
                        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform ${
                          style.bg
                        } ${
                          selected
                            ? `ring-2 ${style.ring} ring-offset-2 ring-offset-slate-900 scale-105`
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {selected && <Check className="h-4 w-4 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {displayError && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-rose-500/40 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
              >
                {displayError}
              </div>
            )}

            {mode === 'join' ? (
              <form onSubmit={handleJoinSubmit} className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="room-code-input"
                    className="block text-sm font-medium text-slate-200"
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
                    className="font-mono-tabular mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-xl font-bold tracking-[0.2em] text-white uppercase placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <button
                  type="submit"
                  disabled={connectionStatus !== 'connected' || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-base font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'กำลังเข้าร่วมห้อง...' : 'เข้าร่วมห้อง'}</span>
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
                      ปิดได้หากต้องการใช้หน้าจอนี้เป็นจอหลักขึ้นโปรเจกเตอร์หรือแชร์สกรีนอย่างเดียว
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
                  <span className="text-slate-400">ชุดคำถามที่เลือก: </span>
                  <span className="font-semibold text-white">
                    {selectedDeck?.title}
                  </span>
                  <span className="text-slate-400">
                    {' '}
                    · {selectedDeck?.questions.length} ข้อ
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={connectionStatus !== 'connected' || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3.5 text-base font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'กำลังเปิดห้อง...' : 'เปิดห้องและรับรหัสห้อง'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </section>

        {/* Right column: Curated Quiz Decks Selector */}
        <section className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/90 p-7 sm:p-9">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">คลังชุดคำถามพร้อมเล่น</h2>
                <p className="mt-1 text-sm text-slate-400">
                  เลือกชุดคำถามที่ต้องการ หรือสร้างชุดคำถามของกลุ่มคุณเอง
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenBuilder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Plus className="h-4 w-4" />
                <span>สร้างควิซเอง</span>
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {allDecks.map((deck) => {
                const isSelected = deck.id === selectedDeck?.id;
                return (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() => {
                      setSelectedDeckId(deck.id);
                      setMode('create');
                      setLocalError(null);
                    }}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/35'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-bold text-white">
                          {deck.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-400">
                          {deck.category}
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">{deck.questions.length} ข้อ</span>
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">ข้อละ {deck.defaultTimeLimitSec} วินาที</span>
                          {deck.isCustom ? ' · ชุดคำถามของคุณ' : ''}
                        </p>
                      </div>
                      <span
                        className={`mt-0.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                          isSelected ? 'text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        {isSelected ? 'เลือกอยู่' : 'เลือกใช้'}
                      </span>
                    </div>
                    {deck.description && (
                      <p className="mt-2.5 text-sm leading-relaxed text-slate-300 line-clamp-2">
                        {deck.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
            <span>สถานะการเชื่อมต่อระบบห้อง</span>
            <span className="font-medium text-slate-200">
              {connectionStatus === 'connected'
                ? transportMode === 'peer'
                  ? 'พร้อมใช้งาน (โหมดออนไลน์ Peer-to-Peer)'
                  : 'พร้อมใช้งาน (เชื่อมต่อเซิร์ฟเวอร์เรียลไทม์แล้ว)'
                : connectionStatus === 'reconnecting'
                ? 'กำลังเชื่อมต่อใหม่...'
                : 'กำลังตรวจสอบการเชื่อมต่อ...'}
            </span>
          </div>
        </section>
      </div>

      {/* 4-column Feature Strip below Hero Split */}
      <section className="mt-10 grid grid-cols-1 gap-6 border-t border-slate-800/80 pt-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="h-4 w-4 text-indigo-400" />
            <span>ซิงก์ห้องเดียวกันแบบสด</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ทุกคนเห็นคำถามและเวลานับถอยหลังพร้อมกันผ่าน WebSocket โดยเซิร์ฟเวอร์คุมจังหวะกลาง
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Zap className="h-4 w-4 text-amber-400" />
            <span>คะแนนตามความไวและสตรีค</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ยิ่งตอบถูกและเร็ว ยิ่งได้คะแนนสูงถึง 1,000 คะแนน พร้อมโบนัสตอบถูกต่อเนื่องสูงสุด 500 คะแนน
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Timer className="h-4 w-4 text-emerald-400" />
            <span>คุมจังหวะห้องได้ดั่งใจ</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            ผู้คุมห้องกดเฉลยทันที เลื่อนข้อถัดไป หรือเปิดโหมดเดินหน้าอัตโนมัติได้ตลอดเวลา
          </p>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Layers className="h-4 w-4 text-sky-400" />
            <span>สร้างข้อสอบเฉพาะกลุ่ม</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            แต่งคำถาม 2–4 ตัวเลือก พร้อมคำอธิบายหลังเฉลย และบันทึกเก็บไว้เล่นซ้ำได้ทันที
          </p>
        </div>
      </section>
    </main>
  );
}
