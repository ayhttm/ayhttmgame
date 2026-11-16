import { useEffect, useMemo, useState } from 'react';
import { HomeView } from './components/HomeView.tsx';
import { QuizBuilderView } from './components/QuizBuilderView.tsx';
import { RoomArena } from './components/RoomArena.tsx';
import { TopBar, type AppView } from './components/TopBar.tsx';
import { PRESET_QUIZ_DECKS } from './data/presets.ts';
import { useQuizSocket } from './hooks/useQuizSocket.ts';
import type { AvatarColor, QuizDeck } from './types/quiz.ts';

const CUSTOM_DECKS_KEY = 'quizsync_custom_decks';
const PROFILE_KEY = 'quizsync_player_profile';

function loadCustomDecks(): QuizDeck[] {
  try {
    const raw = localStorage.getItem(CUSTOM_DECKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadProfile(): { name: string; color: AvatarColor } {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { name: '', color: 'indigo' };
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      color: parsed.color || 'indigo',
    };
  } catch {
    return { name: '', color: 'indigo' };
  }
}

function getRoomCodeFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  return code ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
}

export default function App() {
  const socket = useQuizSocket();
  const [view, setView] = useState<AppView>('home');
  const [homeMode, setHomeMode] = useState<'join' | 'create'>('create');
  const [navCounter, setNavCounter] = useState<number>(0);
  const [urlRoomCode, setUrlRoomCode] = useState<string>(() => getRoomCodeFromUrl());
  const [customDecks, setCustomDecks] = useState<QuizDeck[]>(() => loadCustomDecks());
  const [profile, setProfile] = useState<{ name: string; color: AvatarColor }>(() =>
    loadProfile()
  );

  const allDecks = useMemo(
    () => [...customDecks, ...PRESET_QUIZ_DECKS],
    [customDecks]
  );

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_DECKS_KEY, JSON.stringify(customDecks));
    } catch {
      // Ignore storage quota issues
    }
  }, [customDecks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (socket.room) {
      const nextUrl = `${window.location.pathname}?room=${socket.room.roomCode}`;
      window.history.replaceState(null, '', nextUrl);
    } else if (window.location.search.includes('room=') && !urlRoomCode) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [socket.room, urlRoomCode]);

  const handleUpdateProfile = (name: string, color: AvatarColor) => {
    const next = { name, color };
    setProfile(next);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  };

  const handleSaveDeck = (deck: QuizDeck) => {
    setCustomDecks((prev) => {
      const exists = prev.some((d) => d.id === deck.id);
      if (exists) {
        return prev.map((d) => (d.id === deck.id ? deck : d));
      }
      return [deck, ...prev];
    });
  };

  const handleDeleteDeck = (deckId: string) => {
    setCustomDecks((prev) => prev.filter((d) => d.id !== deckId));
  };

  const handleHostFromBuilder = (deck: QuizDeck) => {
    const hostName = profile.name.trim() || 'ผู้คุมห้อง';
    socket.createRoom(hostName, profile.color, deck, { hostPlays: true });
    setView('home');
  };

  const handleLeaveRoom = () => {
    socket.leaveRoom();
    setUrlRoomCode('');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleNavigate = (nextView: AppView, focusMode?: 'join' | 'create') => {
    setView(nextView);
    if (focusMode) {
      setHomeMode(focusMode);
      setNavCounter((n) => n + 1);
      if (focusMode === 'create') {
        setUrlRoomCode('');
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#090E1A] bg-stage-grid text-slate-100">
      <TopBar
        currentView={view}
        inRoom={Boolean(socket.room)}
        onNavigate={handleNavigate}
        onLeaveRoom={handleLeaveRoom}
      />

      {socket.room ? (
        <RoomArena
          clientId={socket.clientId}
          room={socket.room}
          clockOffsetMs={socket.clockOffsetMs}
          allDecks={allDecks}
          reactions={socket.reactions}
          connectionStatus={socket.status}
          errorMessage={socket.errorMessage}
          onRetryConnection={socket.retryConnection}
          onUpdateSettings={socket.updateSettings}
          onChangeQuiz={socket.changeQuiz}
          onStartGame={socket.startGame}
          onSubmitAnswer={socket.submitAnswer}
          onEndQuestion={socket.endQuestion}
          onNextStep={socket.nextStep}
          onRestartGame={socket.restartGame}
          onSendReaction={socket.sendReaction}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : view === 'builder' ? (
        <QuizBuilderView
          customDecks={customDecks}
          onSaveDeck={handleSaveDeck}
          onDeleteDeck={handleDeleteDeck}
          onHostDeck={handleHostFromBuilder}
        />
      ) : (
        <HomeView
          initialMode={homeMode}
          navCounter={navCounter}
          initialRoomCode={urlRoomCode}
          playerName={profile.name}
          playerColor={profile.color}
          allDecks={allDecks}
          connectionStatus={socket.status}
          transportMode={socket.transportMode}
          isSubmitting={socket.isSubmitting}
          errorMessage={socket.errorMessage}
          onClearError={socket.clearError}
          onRetryConnection={socket.retryConnection}
          onUpdateProfile={handleUpdateProfile}
          onJoinRoom={(code, name, color) => {
            handleUpdateProfile(name, color);
            socket.joinRoom(code, name, color);
          }}
          onCreateRoom={(name, color, deck, hostPlays) => {
            handleUpdateProfile(name, color);
            socket.createRoom(name, color, deck, { hostPlays });
          }}
          onOpenBuilder={() => setView('builder')}
        />
      )}
    </div>
  );
}
