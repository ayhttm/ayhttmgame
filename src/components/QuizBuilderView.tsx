import { useState } from 'react';
import { ArrowRight, Check, Plus, Trash2 } from 'lucide-react';
import type { QuizDeck, QuizQuestion } from '../types/quiz.ts';

interface QuizBuilderViewProps {
  customDecks: QuizDeck[];
  onSaveDeck: (deck: QuizDeck) => void;
  onDeleteDeck: (deckId: string) => void;
  onHostDeck: (deck: QuizDeck) => void;
}

function createBlankQuestion(index: number): QuizQuestion {
  return {
    id: `q-${Date.now()}-${index}`,
    prompt: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    explanation: '',
  };
}

function createBlankDeck(): QuizDeck {
  return {
    id: `custom-${Date.now()}`,
    title: 'ชุดคำถามใหม่ของฉัน',
    category: 'ควิซสร้างเอง',
    description: '',
    defaultTimeLimitSec: 15,
    isCustom: true,
    questions: [createBlankQuestion(1), createBlankQuestion(2)],
  };
}

export function QuizBuilderView({
  customDecks,
  onSaveDeck,
  onDeleteDeck,
  onHostDeck,
}: QuizBuilderViewProps) {
  const [draft, setDraft] = useState<QuizDeck>(() =>
    customDecks.length > 0 ? structuredClone(customDecks[0]) : createBlankDeck()
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateAndNormalize = (): QuizDeck | null => {
    if (!draft.title.trim()) {
      setError('กรุณาตั้งชื่อชุดคำถาม');
      return null;
    }

    const cleanedQuestions: QuizQuestion[] = [];
    for (let i = 0; i < draft.questions.length; i++) {
      const q = draft.questions[i];
      const prompt = q.prompt.trim();
      if (!prompt) {
        setError(`กรุณากรอกคำถามในข้อที่ ${i + 1}`);
        return null;
      }

      const validOptionsWithIndex = q.options
        .map((opt, idx) => ({ text: opt.trim(), origIdx: idx }))
        .filter((item) => item.text.length > 0);

      if (validOptionsWithIndex.length < 2) {
        setError(`ข้อที่ ${i + 1} ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`);
        return null;
      }

      const mappedCorrect = validOptionsWithIndex.findIndex(
        (item) => item.origIdx === q.correctIndex
      );
      if (mappedCorrect === -1) {
        setError(`กรุณาเลือกคำตอบที่ถูกต้องที่มีข้อความในข้อที่ ${i + 1}`);
        return null;
      }

      cleanedQuestions.push({
        id: q.id,
        prompt,
        options: validOptionsWithIndex.map((item) => item.text),
        correctIndex: mappedCorrect,
        explanation: q.explanation?.trim() || undefined,
      });
    }

    setError(null);
    return {
      ...draft,
      title: draft.title.trim(),
      category: draft.category.trim() || 'ควิซสร้างเอง',
      description: draft.description.trim(),
      isCustom: true,
      questions: cleanedQuestions,
    };
  };

  const handleSave = () => {
    const normalized = validateAndNormalize();
    if (!normalized) return;
    onSaveDeck(normalized);
    setDraft(structuredClone(normalized));
    setFeedback('บันทึกชุดคำถามเรียบร้อยแล้ว');
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleHostNow = () => {
    const normalized = validateAndNormalize();
    if (!normalized) return;
    onSaveDeck(normalized);
    onHostDeck(normalized);
  };

  const updateQuestion = (qIndex: number, updater: (q: QuizQuestion) => QuizQuestion) => {
    setDraft((prev) => ({
      ...prev,
      questions: prev.questions.map((q, idx) => (idx === qIndex ? updater(q) : q)),
    }));
  };

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white sm:text-3xl">
            สตูดิโอสร้างชุดคำถาม
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            สร้างควิซของกลุ่มคุณเอง บันทึกลงเครื่อง แล้วเปิดห้องเล่นออนไลน์ได้ทันที
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setFeedback(null);
              setDraft(createBlankDeck());
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>สร้างชุดใหม่</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            บันทึกชุดคำถาม
          </button>
          <button
            type="button"
            onClick={handleHostNow}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 whitespace-nowrap shrink-0"
          >
            <span>เปิดห้องเล่นทันที</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Saved Custom Decks Sidebar */}
        <aside className="lg:col-span-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-300">
            ชุดคำถามที่คุณสร้างไว้ ({customDecks.length})
          </h2>
          {customDecks.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
              ยังไม่มีชุดคำถามที่บันทึกไว้ กรอกคำถามด้านขวาแล้วกด “บันทึกชุดคำถาม” ได้เลย
            </div>
          ) : (
            customDecks.map((deck) => {
              const active = deck.id === draft.id;
              return (
                <div
                  key={deck.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    active
                      ? 'border-indigo-500 bg-indigo-950/35'
                      : 'border-slate-800 bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setDraft(structuredClone(deck));
                      }}
                      className="text-left flex-1"
                    >
                      <p className="font-bold text-white">{deck.title}</p>
                      <p className="mt-1 text-xs text-slate-400 tabular-nums">
                        {deck.questions.length} ข้อ · ข้อละ {deck.defaultTimeLimitSec} วิ
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`ลบ ${deck.title}`}
                      onClick={() => {
                        onDeleteDeck(deck.id);
                        if (draft.id === deck.id) {
                          setDraft(createBlankDeck());
                        }
                      }}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </aside>

        {/* Main Editor */}
        <section className="lg:col-span-8 space-y-6">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-200"
            >
              {error}
            </div>
          )}
          {feedback && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 py-3 text-sm text-emerald-200">
              <Check className="h-4 w-4" />
              <span>{feedback}</span>
            </div>
          )}

          {/* Deck Metadata */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-200">
                  ชื่อชุดคำถาม
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200">
                  เวลาต่อข้อ (วินาที)
                </label>
                <select
                  value={draft.defaultTimeLimitSec}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      defaultTimeLimitSec: Number(e.target.value),
                    })
                  }
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value={10}>10 วินาที (เร็วมาก)</option>
                  <option value={15}>15 วินาที (มาตรฐาน)</option>
                  <option value={20}>20 วินาที (กำลังดี)</option>
                  <option value={30}>30 วินาที (คำถามคิดวิเคราะห์)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-200">
                  หมวดหมู่
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-200">
                  คำอธิบายสั้นๆ (ไม่บังคับ)
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="เช่น ควิซทบทวนก่อนสอบ หรือเกมปาร์ตี้ประจำออฟฟิศ"
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Questions List */}
          <div className="space-y-4">
            {draft.questions.map((q, qIdx) => (
              <div
                key={q.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 space-y-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-bold text-indigo-300 tabular-nums">
                    คำถามข้อที่ {qIdx + 1}
                  </span>
                  {draft.questions.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          questions: prev.questions.filter((_, i) => i !== qIdx),
                        }))
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>ลบข้อนี้</span>
                    </button>
                  )}
                </div>

                <div>
                  <input
                    type="text"
                    maxLength={240}
                    value={q.prompt}
                    onChange={(e) =>
                      updateQuestion(qIdx, (curr) => ({
                        ...curr,
                        prompt: e.target.value,
                      }))
                    }
                    placeholder="พิมพ์คำถามที่นี่..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base font-medium text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {q.options.map((opt, optIdx) => {
                    const isCorrect = q.correctIndex === optIdx;
                    return (
                      <div
                        key={optIdx}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
                          isCorrect
                            ? 'border-emerald-500/70 bg-emerald-950/30'
                            : 'border-slate-800 bg-slate-950/70'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            updateQuestion(qIdx, (curr) => ({
                              ...curr,
                              correctIndex: optIdx,
                            }))
                          }
                          aria-label={`ตั้งตัวเลือกที่ ${optIdx + 1} เป็นคำตอบที่ถูก`}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                            isCorrect
                              ? 'border-emerald-400 bg-emerald-600 text-white'
                              : 'border-slate-600 bg-slate-900 text-transparent hover:border-slate-400'
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <input
                          type="text"
                          maxLength={120}
                          value={opt}
                          onChange={(e) =>
                            updateQuestion(qIdx, (curr) => {
                              const nextOptions = [...curr.options];
                              nextOptions[optIdx] = e.target.value;
                              return { ...curr, options: nextOptions };
                            })
                          }
                          placeholder={`ตัวเลือกที่ ${optIdx + 1}${
                            optIdx >= 2 ? ' (เว้นว่างได้)' : ''
                          }`}
                          className="w-full bg-transparent py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                        />
                      </div>
                    );
                  })}
                </div>

                <div>
                  <input
                    type="text"
                    maxLength={240}
                    value={q.explanation ?? ''}
                    onChange={(e) =>
                      updateQuestion(qIdx, (curr) => ({
                        ...curr,
                        explanation: e.target.value,
                      }))
                    }
                    placeholder="คำอธิบายเพิ่มเติมหลังเฉลย (ไม่บังคับ)"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-sm text-slate-300 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  questions: [
                    ...prev.questions,
                    createBlankQuestion(prev.questions.length + 1),
                  ],
                }))
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-4 text-sm font-semibold text-slate-300 transition-colors hover:border-indigo-500 hover:text-white"
            >
              <Plus className="h-4 w-4" />
              <span>เพิ่มคำถามข้อใหม่</span>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
