import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLiveAPI } from './hooks/useLiveAPI';
import { ConnectionState } from './types';
import Visualizer from './components/Visualizer';

const CopyIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const App: React.FC = () => {
  const [transcript, setTranscript] = useState<{user: string, model: string}[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<{type: 'user'|'model'|'all', index?: number} | null>(null);
  const [audioSpeed, setAudioSpeed] = useState<number>(1.0);
  
  // Ref to keep transcript window scrolled down
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const handleTranscriptionUpdate = useCallback((userText: string, modelText: string) => {
    setTranscript(prev => {
        const last = prev[prev.length - 1];
        if (userText) {
            // Check if we should append to last user turn or new turn
            if (last && !last.model && last.user) {
                return [...prev.slice(0, -1), { ...last, user: last.user + userText }];
            }
            return [...prev, { user: userText, model: '' }];
        }
        if (modelText) {
             if (last && last.model !== undefined) {
                 return [...prev.slice(0, -1), { ...last, model: last.model + modelText }];
             }
             // Should not happen usually as model replies to user
             return [...prev, { user: '', model: modelText }];
        }
        return prev;
    });
  }, []);

  const { connect, disconnect, connectionState, errorMessage, volume } = useLiveAPI({
    onTranscriptionUpdate: handleTranscriptionUpdate,
    audioSpeed
  });

  const handleToggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      setTranscript([]); // Clear transcript on new session
      connect();
    }
  };

  const copyToClipboard = (text: string, type: 'user' | 'model' | 'all', index?: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex({ type, index });
      setTimeout(() => setCopiedIndex(null), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  const copyFullLog = () => {
    const log = transcript.map(t => 
      `${t.user ? `Вы: ${t.user}\n` : ''}${t.model ? `AI: ${t.model}\n` : ''}`
    ).join('\n');
    copyToClipboard(log, 'all');
  };

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-2xl mb-8 flex flex-col items-center">
        <div className="flex items-center gap-3 mb-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">AI Репетитор</h1>
        </div>
        <p className="text-slate-500 text-center max-w-md">
          Ваш персональный помощник для практики английского языка.
        </p>
      </header>

      <main className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col h-[600px]">
        {/* Settings / Top Bar */}
        <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex flex-row justify-between items-center gap-4">
          <button 
            onClick={copyFullLog}
            className="flex items-center gap-2 text-indigo-700 hover:text-indigo-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-indigo-100/50 text-sm font-medium"
            title="Копировать весь разговор"
          >
            {copiedIndex?.type === 'all' ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
            <span>{copiedIndex?.type === 'all' ? 'Скопировано!' : 'Копировать чат'}</span>
          </button>
          
          <div className="flex items-center gap-2">
             <div className={`h-3 w-3 rounded-full ${
                 connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse' : 
                 connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500' : 'bg-red-400'
             }`}></div>
             <span className="text-sm text-indigo-900 font-medium capitalize">
                 {connectionState === ConnectionState.CONNECTED ? 'Онлайн' : 
                  connectionState === ConnectionState.CONNECTING ? 'Подключение' : 'Оффлайн'}
             </span>
          </div>
        </div>

        {/* Visualizer Area */}
        <div className="flex-none p-8 flex flex-col items-center justify-center bg-slate-900 min-h-[160px]">
           <Visualizer isActive={connectionState === ConnectionState.CONNECTED} volume={volume} />
           <p className="mt-4 text-slate-400 text-sm font-medium">
             {connectionState === ConnectionState.CONNECTED ? 'Слушаю... (говорите по-русски или по-английски)' : 'Нажмите кнопку, чтобы начать урок'}
           </p>
        </div>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {transcript.length === 0 && connectionState === ConnectionState.CONNECTED && (
                <div className="text-center text-slate-400 mt-8">
                    Скажите "Привет", чтобы начать разговор, или задайте вопрос на русском.
                </div>
            )}
            
            {transcript.map((turn, idx) => (
                <React.Fragment key={idx}>
                    {turn.user && (
                        <div className="flex justify-end items-end group gap-2">
                            <button 
                                onClick={() => copyToClipboard(turn.user, 'user', idx)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600 p-1"
                                title="Копировать"
                            >
                                {copiedIndex?.type === 'user' && copiedIndex?.index === idx ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                            </button>
                            <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-none py-2 px-4 max-w-[80%] shadow-sm">
                                <p className="text-sm">{turn.user}</p>
                            </div>
                        </div>
                    )}
                    {turn.model && (
                        <div className="flex justify-start items-end group gap-2">
                            <div className="bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-none py-2 px-4 max-w-[80%] shadow-sm">
                                <p className="text-sm">{turn.model}</p>
                            </div>
                            <button 
                                onClick={() => copyToClipboard(turn.model, 'model', idx)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600 p-1"
                                title="Копировать"
                            >
                                {copiedIndex?.type === 'model' && copiedIndex?.index === idx ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                            </button>
                        </div>
                    )}
                </React.Fragment>
            ))}
            <div ref={transcriptEndRef} />
        </div>

        {/* Control Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex flex-col items-center gap-2">
            {errorMessage && (
                <div className="text-red-500 text-sm mb-2 text-center bg-red-50 p-2 rounded w-full">
                    {errorMessage}
                </div>
            )}
            
            {/* Speed Control */}
            <div className="w-full max-w-xs mb-2">
                <label className="flex justify-between text-xs text-slate-500 font-semibold mb-1 uppercase tracking-wider">
                    <span>Скорость речи</span>
                    <span>{audioSpeed.toFixed(1)}x</span>
                </label>
                <input 
                    type="range" 
                    min="0.7" 
                    max="1.5" 
                    step="0.1" 
                    value={audioSpeed}
                    onChange={(e) => setAudioSpeed(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
            </div>

            <button
                onClick={handleToggleConnection}
                disabled={connectionState === ConnectionState.CONNECTING}
                className={`
                    w-full py-3 px-6 rounded-xl font-bold text-white shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98]
                    ${connectionState === ConnectionState.CONNECTED 
                        ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' 
                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30'}
                    disabled:opacity-70 disabled:cursor-not-allowed
                `}
            >
                {connectionState === ConnectionState.CONNECTED ? 'Закончить урок' : 
                 connectionState === ConnectionState.CONNECTING ? 'Подключение...' : 'Начать урок'}
            </button>
            
            <p className="text-xs text-slate-400 mt-1">
                Для лучшего опыта используйте наушники.
            </p>
        </div>

      </main>
      
      <footer className="mt-8 text-slate-400 text-sm text-center">
        Powered by Gemini 2.5 Flash Native Audio (Live API)
      </footer>
    </div>
  );
};

export default App;