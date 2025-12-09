
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLiveAPI } from './hooks/useLiveAPI';
import { ConnectionState, TurnState, SpeedMode } from './types';
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

const MicIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);

const StopCircleIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm6-2.25a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1-.75-.75v-4.5Z" clipRule="evenodd" />
  </svg>
);

const App: React.FC = () => {
  const [transcript, setTranscript] = useState<{user: string, model: string}[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<{type: 'user'|'model'|'all', index?: number} | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<SpeedMode>('normal');
  
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const handleTranscriptionUpdate = useCallback((userText: string, modelText: string) => {
    setTranscript(prev => {
        const last = prev[prev.length - 1];
        if (userText) {
            if (last && !last.model && last.user) {
                return [...prev.slice(0, -1), { ...last, user: last.user + userText }];
            }
            return [...prev, { user: userText, model: '' }];
        }
        if (modelText) {
             if (last && last.model !== undefined) {
                 return [...prev.slice(0, -1), { ...last, model: last.model + modelText }];
             }
             return [...prev, { user: '', model: modelText }];
        }
        return prev;
    });
  }, []);

  const { 
    connect, 
    disconnect, 
    interrupt, 
    changeSpeed,
    connectionState, 
    turnState, 
    errorMessage, 
    volume 
  } = useLiveAPI({ onTranscriptionUpdate: handleTranscriptionUpdate });

  const handleModeChange = (mode: SpeedMode) => {
      setCurrentSpeed(mode);
      changeSpeed(mode); 
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

  const speedOptions: { id: SpeedMode, label: string }[] = [
      { id: 'v-slow', label: 'Очень медленно' },
      { id: 'slow', label: 'Медленно' },
      { id: 'normal', label: 'Нормально' },
      { id: 'fast', label: 'Быстро' },
      { id: 'v-fast', label: 'Очень быстро' },
  ];

  const isAISpeaking = turnState === TurnState.AI_SPEAKING;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-2xl mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">AI Репетитор</h1>
        </div>
        {connectionState === ConnectionState.CONNECTED && (
            <button 
                onClick={disconnect}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-full transition-colors"
                title="Завершить сессию"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        )}
      </header>

      <main className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col h-[650px]">
        {/* Status Bar */}
        <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex flex-row justify-between items-center gap-4">
          <button 
            onClick={copyFullLog}
            className="flex items-center gap-2 text-indigo-700 hover:text-indigo-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-indigo-100/50 text-sm font-medium"
            title="Копировать весь разговор"
          >
            {copiedIndex?.type === 'all' ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
            <span>{copiedIndex?.type === 'all' ? 'Скопировано!' : 'Копировать чат'}</span>
          </button>
          
          <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-indigo-100 shadow-sm">
             <div className={`h-2.5 w-2.5 rounded-full ${
                 connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse' : 
                 connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500' : 'bg-slate-300'
             }`}></div>
             <span className="text-xs text-slate-600 font-medium uppercase tracking-wide">
                 {connectionState === ConnectionState.CONNECTED ? 'Онлайн' : 
                  connectionState === ConnectionState.CONNECTING ? 'Подключение' : 'Оффлайн'}
             </span>
          </div>
        </div>

        {/* Visualizer Area */}
        <div className="flex-none p-6 flex flex-col items-center justify-center bg-slate-900 min-h-[140px] relative transition-colors duration-500 border-b border-slate-800">
           <Visualizer isActive={connectionState === ConnectionState.CONNECTED && !isAISpeaking} volume={volume} />
           <p className="mt-4 text-slate-400 text-sm font-medium animate-fade-in h-5">
             {connectionState === ConnectionState.CONNECTED 
               ? (isAISpeaking ? 'AI говорит (нажмите кнопку, чтобы прервать)' : 'Слушаю вас... Говорите')
               : 'Начните урок'}
           </p>
        </div>

        {/* Transcript Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
            {transcript.length === 0 && connectionState === ConnectionState.CONNECTED && (
                <div className="text-center text-slate-400 mt-8 p-4 bg-white rounded-xl border border-slate-100 shadow-sm">
                    <p>👋 Урок начался!</p>
                    <p className="text-sm mt-1">Скажите что-нибудь по-русски или по-английски.</p>
                </div>
            )}
            
            {transcript.map((turn, idx) => (
                <React.Fragment key={idx}>
                    {turn.user && (
                        <div className="flex justify-end items-end group gap-2">
                            <button 
                                onClick={() => copyToClipboard(turn.user, 'user', idx)}
                                className="text-slate-300 hover:text-indigo-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Копировать"
                            >
                                {copiedIndex?.type === 'user' && copiedIndex?.index === idx ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                            </button>
                            <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-none py-2 px-4 max-w-[85%] shadow-sm">
                                <p className="text-sm leading-relaxed">{turn.user}</p>
                            </div>
                        </div>
                    )}
                    {turn.model && (
                        <div className="flex justify-start items-end group gap-2">
                            <div className="bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-none py-2 px-4 max-w-[85%] shadow-sm">
                                <p className="text-sm leading-relaxed">{turn.model}</p>
                            </div>
                            <button 
                                onClick={() => copyToClipboard(turn.model, 'model', idx)}
                                className="text-slate-300 hover:text-indigo-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
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

        {/* Footer Controls */}
        <div className="p-4 bg-white border-t border-slate-100">
            {errorMessage && (
                <div className="text-red-500 text-sm mb-3 text-center bg-red-50 p-2 rounded-lg border border-red-100">
                    {errorMessage}
                </div>
            )}
            
            {/* Speed Control Modes */}
            {connectionState === ConnectionState.CONNECTED && (
                <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                         <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Скорость речи (применится к след. фразе)</span>
                    </div>
                    <div className="flex w-full bg-slate-100 p-1 rounded-xl">
                        {speedOptions.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => handleModeChange(option.id)}
                                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                                    currentSpeed === option.id 
                                    ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200' 
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                }`}
                            >
                                <span className="hidden sm:inline">{option.label}</span>
                                <span className="sm:hidden">{
                                    option.id === 'v-slow' ? '0.5x' :
                                    option.id === 'slow' ? '0.7x' :
                                    option.id === 'normal' ? '1x' :
                                    option.id === 'fast' ? '1.2x' : '1.5x'
                                }</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Action Button */}
            <div className="flex items-center justify-center">
                {connectionState === ConnectionState.CONNECTED ? (
                    <button
                        onClick={isAISpeaking ? interrupt : undefined}
                        className={`
                          w-20 h-20 rounded-full shadow-lg flex items-center justify-center transition-all 
                          ${isAISpeaking 
                            ? 'bg-rose-500 text-white hover:bg-rose-600 ring-4 ring-rose-200 animate-pulse cursor-pointer' 
                            : 'bg-indigo-100 text-indigo-600 ring-4 ring-indigo-50 cursor-default'
                          }
                        `}
                        title={isAISpeaking ? "Прервать AI и говорить" : "Микрофон активен, говорите"}
                    >
                        {isAISpeaking ? (
                            <StopCircleIcon className="h-10 w-10" />
                        ) : (
                            <MicIcon className="h-8 w-8" />
                        )}
                    </button>
                ) : (
                    <button
                        onClick={connect}
                        disabled={connectionState === ConnectionState.CONNECTING}
                        className="w-full max-w-sm py-4 rounded-xl font-bold text-white shadow-xl shadow-indigo-200 bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all disabled:opacity-70 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                    >
                        {connectionState === ConnectionState.CONNECTING ? (
                            <>
                                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"/>
                                <span>Подключение...</span>
                            </>
                        ) : (
                            <>
                                <MicIcon className="h-6 w-6" />
                                <span>Начать урок</span>
                            </>
                        )}
                    </button>
                )}
            </div>
            {connectionState === ConnectionState.CONNECTED && (
                 <div className="text-center mt-3 text-xs text-slate-400">
                     {isAISpeaking ? 'Нажмите, чтобы прервать AI' : 'Микрофон включен автоматически. Говорите.'}
                 </div>
            )}
        </div>

      </main>
      
      <footer className="mt-8 text-slate-400 text-xs text-center font-medium">
        Powered by Gemini 2.5 Flash Native Audio (Live API)
      </footer>
    </div>
  );
};

export default App;
