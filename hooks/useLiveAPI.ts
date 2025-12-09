
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, TurnState, SpeedMode } from '../types';
import { decode, decodeAudioData, createBlob } from '../utils/audio-utils';

interface UseLiveAPIProps {
  onTranscriptionUpdate: (user: string, model: string) => void;
}

export const useLiveAPI = ({ onTranscriptionUpdate }: UseLiveAPIProps) => {
  // --- State ---
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [turnState, setTurnState] = useState<TurnState>(TurnState.USER_SPEAKING);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(0);

  // --- Refs ---
  const currentSpeedModeRef = useRef<SpeedMode>('normal');
  const pendingSpeedUpdateRef = useRef<boolean>(false);
  
  // Audio Refs
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Queue & Playback Refs
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const isInterruptedRef = useRef<boolean>(false);
  
  // API Session Ref
  const sessionRef = useRef<any>(null);

  // --- Helpers ---

  const getSystemPromptForSpeed = (mode: SpeedMode): string => {
    switch (mode) {
      case 'v-slow': return "System: Speak extremely slowly and clearly.";
      case 'slow': return "System: Speak slowly.";
      case 'fast': return "System: Speak fast.";
      case 'v-fast': return "System: Speak very fast.";
      default: return "System: Speak at a normal conversational pace.";
    }
  };

  const playNextInQueue = useCallback(() => {
    const ctx = audioContextsRef.current?.output;
    if (!ctx || isInterruptedRef.current) {
        return;
    }

    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      setTurnState(TurnState.USER_SPEAKING);
      return;
    }

    isPlayingRef.current = true;
    setTurnState(TurnState.AI_SPEAKING);

    const buffer = audioQueueRef.current.shift()!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    const currentTime = ctx.currentTime;
    // Add a tiny buffer to prevent overlap/glitches if we are slightly behind
    if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime + 0.05;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
    
    currentSourceRef.current = source;

    source.onended = () => {
       if (currentSourceRef.current === source) {
           playNextInQueue();
       }
    };
  }, []);

  const queueAudio = useCallback(async (base64Data: string) => {
    // If we have been interrupted, discard all incoming audio for this turn
    if (isInterruptedRef.current) return;

    const ctx = audioContextsRef.current?.output;
    if (!ctx) return;

    try {
      const buffer = await decodeAudioData(decode(base64Data), ctx, 24000, 1);
      audioQueueRef.current.push(buffer);
      
      if (!isPlayingRef.current) {
        playNextInQueue();
      }
    } catch (e) {
      console.error("Audio decode error", e);
    }
  }, [playNextInQueue]);

  const interrupt = useCallback(() => {
    console.log("Interrupting...");
    isInterruptedRef.current = true;

    // 1. Stop current source immediately
    if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch(e) {}
        currentSourceRef.current = null;
    }
    
    // 2. Clear queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;

    // 3. Update State
    setTurnState(TurnState.USER_SPEAKING);
    
    // 4. Send a text signal to the model to acknowledge the stop (optional, but helps reset context)
    if (sessionRef.current) {
        sessionRef.current.sendRealtimeInput({ text: "." }); 
    }
  }, []);

  const changeSpeed = useCallback((mode: SpeedMode) => {
    currentSpeedModeRef.current = mode;
    pendingSpeedUpdateRef.current = true;
    
    // If we are currently listening to the user, we can send the update immediately
    // so it applies to the current ongoing turn.
    if (!isPlayingRef.current && sessionRef.current) {
         const cmd = getSystemPromptForSpeed(mode);
         sessionRef.current.sendRealtimeInput({ text: cmd });
         pendingSpeedUpdateRef.current = false;
    }
  }, []);

  // --- Connection Logic ---

  const disconnect = useCallback(() => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
        audioContextsRef.current = null;
    }
    if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
    }
    
    setConnectionState(ConnectionState.DISCONNECTED);
    setTurnState(TurnState.USER_SPEAKING);
    setErrorMessage(null);
    setVolume(0);
  }, []);

  const connect = useCallback(async () => {
    try {
      // Ensure clean state
      disconnect(); 
      setConnectionState(ConnectionState.CONNECTING);
      
      // 1. Setup Audio Contexts
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      // 2. Setup Processor
      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(inputCtx.destination);

      // 3. Setup GenAI
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: `You are a professional Russian-English language tutor. 
            Your goal is to help a Russian speaker practice English.
            
            Protocol:
            - If the user speaks Russian, reply in Russian, then guide them to say it in English.
            - If the user speaks English, reply in English to keep the conversation going.
            - Correct mistakes gently.
            - Keep responses short and conversational.
            - IMPORTANT: Always obey the "Speak slowly" or "Speak fast" commands immediately.
            `,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        callbacks: {
            onopen: () => {
                setConnectionState(ConnectionState.CONNECTED);
                setTurnState(TurnState.USER_SPEAKING);
            },
            onmessage: (message: LiveServerMessage) => {
                // Audio
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    queueAudio(base64Audio);
                }

                // Transcription
                if (message.serverContent?.outputTranscription?.text) {
                    onTranscriptionUpdate('', message.serverContent.outputTranscription.text);
                }
                if (message.serverContent?.inputTranscription?.text) {
                     // When we get user transcription, it means the user is definitely speaking.
                     // We can ensure interrupt flag is cleared.
                     isInterruptedRef.current = false;
                     onTranscriptionUpdate(message.serverContent.inputTranscription.text, '');
                }

                if (message.serverContent?.turnComplete) {
                     // Server finished generating response.
                     // We don't do anything special here, rely on audio queue to finish.
                }
            },
            onclose: () => {
                disconnect();
            },
            onerror: (e) => {
                console.error(e);
                setErrorMessage("Connection Error");
                disconnect();
            }
        },
        config: config.config as any
      });

      const session = await sessionPromise;
      sessionRef.current = session;

      // 4. Processing Loop
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate Volume
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);
        setVolume(Math.min(rms * 5, 1));

        // Sending Logic
        // STRICTLY ignore input if AI is playing. This prevents echo.
        if (!isPlayingRef.current) {
            
            // Check for pending speed updates
            if (pendingSpeedUpdateRef.current && rms > 0.01) {
                 const cmd = getSystemPromptForSpeed(currentSpeedModeRef.current);
                 session.sendRealtimeInput({ text: cmd });
                 pendingSpeedUpdateRef.current = false;
            }

            const pcmBlob = createBlob(inputData);
            session.sendRealtimeInput({ media: pcmBlob });
        }
      };

    } catch (e: any) {
        console.error(e);
        setErrorMessage(e.message || "Failed to connect");
        disconnect();
    }
  }, [disconnect, onTranscriptionUpdate, queueAudio]);

  return {
    connect,
    disconnect,
    interrupt,
    changeSpeed,
    connectionState,
    turnState,
    errorMessage,
    volume
  };
};
