export type AppView = 'home' | 'builder';

interface TopBarProps {
  currentView: AppView;
  inRoom: boolean;
  onNavigate: (view: AppView, focusMode?: 'join' | 'create') => void;
  onLeaveRoom: () => void;
}

function QuizSyncLogoMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className="h-8 w-8 shrink-0"
    >
      <defs>
        <linearGradient id="qsNavGrad" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#qsNavGrad)" />
      <rect x="14" y="14" width="16" height="16" rx="4" fill="#FFFFFF" fillOpacity="0.95" />
      <rect x="34" y="14" width="16" height="16" rx="4" fill="#FBBF24" />
      <rect x="14" y="34" width="16" height="16" rx="4" fill="#34D399" />
      <path d="M44 34L36 43H42L40 50L48 41H42L44 34Z" fill="#FFFFFF" />
    </svg>
  );
}

export function TopBar({
  currentView,
  inRoom,
  onNavigate,
  onLeaveRoom,
}: TopBarProps) {
  return (
    <header className="border-b border-slate-800/80 bg-[#090E1A]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-6 py-3.5">
        <button
          type="button"
          onClick={() => (inRoom ? onLeaveRoom() : onNavigate('home'))}
          className="flex items-center gap-2.5 text-left text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg"
        >
          <QuizSyncLogoMark />
          <span>QuizSync</span>
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => (inRoom ? onLeaveRoom() : onNavigate('home'))}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-white hover:underline underline-offset-4 ${
              !inRoom && currentView === 'home' ? 'text-white underline' : ''
            }`}
          >
            หน้าแรก
          </button>
          <button
            type="button"
            onClick={() => {
              if (inRoom) onLeaveRoom();
              onNavigate('home', 'join');
            }}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-white hover:underline underline-offset-4"
          >
            เข้าห้องด้วยรหัส
          </button>
          <button
            type="button"
            onClick={() => {
              if (inRoom) onLeaveRoom();
              onNavigate('home', 'create');
            }}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-white hover:underline underline-offset-4"
          >
            เลือกชุดคำถาม
          </button>
          <button
            type="button"
            onClick={() => {
              if (inRoom) onLeaveRoom();
              onNavigate('builder');
            }}
            className={`whitespace-nowrap shrink-0 transition-colors hover:text-white hover:underline underline-offset-4 ${
              !inRoom && currentView === 'builder' ? 'text-white underline' : ''
            }`}
          >
            สร้างชุดคำถามเอง
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          {inRoom ? (
            <button
              type="button"
              onClick={onLeaveRoom}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              ออกจากห้อง
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                onNavigate(currentView === 'builder' ? 'home' : 'builder')
              }
              className="rounded-lg border-b-2 border-indigo-800 bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-indigo-500 active:translate-y-0.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {currentView === 'builder' ? 'กลับหน้าหลัก' : 'สร้างควิซใหม่'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
