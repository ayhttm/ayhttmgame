export type AppView = 'home' | 'builder';

interface TopBarProps {
  currentView: AppView;
  inRoom: boolean;
  onNavigate: (view: AppView, focusMode?: 'join' | 'create') => void;
  onLeaveRoom: () => void;
}

export function TopBar({
  currentView,
  inRoom,
  onNavigate,
  onLeaveRoom,
}: TopBarProps) {
  return (
    <header className="border-b border-slate-800/90 bg-[#0B1120]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-6 py-4">
        <button
          type="button"
          onClick={() => (inRoom ? onLeaveRoom() : onNavigate('home'))}
          className="text-left text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
        >
          QuizSync
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
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {currentView === 'builder' ? 'กลับหน้าหลัก' : 'สร้างควิซใหม่'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
