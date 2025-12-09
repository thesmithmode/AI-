import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState } from '../types';
import { decode, decodeAudioData, createBlob } from '../utils/audio-utils';

interface UseLiveAPIProps {
  onTranscriptionUpdate?: (user: string, model: string) => void;
}

export const useLiveAPI = ({ onTranscriptionUpdate }: UseLiveAPIProps) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Playback State
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const processingModelTurnRef = useRef<boolean>(false);
  
  // Control Logic State
  const ignoringNextTurnRef = useRef<boolean>(false);
  
  // API Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const cleanup = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    activeSourcesRef.current.clear();
    setIsPlaying(false);

    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => {
            if(session.close) session.close();
        }).catch(() => {});
        sessionPromiseRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setVolume(0);
    setIsMuted(false);
    nextStartTimeRef.current = 0;
    processingModelTurnRef.current = false;
    ignoringNextTurnRef.current = false;
  }, []);

  // Helper: Mute/Unmute Logic
  const setMediaMute = useCallback((shouldMute: boolean) => {
      if (streamRef.current) {
          streamRef.current.getAudioTracks().forEach(track => {
              track.enabled = !shouldMute;
          });
          setIsMuted(shouldMute);
      }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    // 1. Synchronously stop all sources
    activeSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) { /* ignore */ }
    });
    activeSourcesRef.current.clear();
    
    // 2. Reset time cursor
    if (outputAudioContextRef.current) {
        nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
    }

    // 3. Reset logic flags
    processingModelTurnRef.current = false;
    setIsPlaying(false); // Trigger React update last
  }, []);

  const sendTextMessage = useCallback((text: string) => {
      if (sessionPromiseRef.current) {
          sessionPromiseRef.current.then(session => {
              session.sendRealtimeInput({ text });
          });
      }
  }, []);

  // Sends a hidden system command.
  // We set ignoringNextTurnRef = true so the model's verbal "Okay" response is discarded.
  const sendControlMessage = useCallback((text: string) => {
    if (sessionPromiseRef.current) {
        ignoringNextTurnRef.current = true; // Flag to ignore the audio response
        sessionPromiseRef.current.then(session => {
            session.sendRealtimeInput({ text });
        });
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMessage(null);
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      outputNode.connect(analyser);
      analyserRef.current = analyser;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Initialize unmuted
      setMediaMute(false);

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: `You are a professional bilingual language tutor. You are a native Russian speaker who is an expert in teaching English.

            CORE BEHAVIOR:
            1. LISTEN CAREFULLY.
            2. IF USER SPEAKS RUSSIAN: You MUST respond in RUSSIAN. Explain concepts, translate, or answer questions in clear Russian. Then, prompt them to say the English equivalent.
            3. IF USER SPEAKS ENGLISH: Respond in English to maintain the flow of practice. Correct mistakes gently.
            4. Keep responses concise and natural.
            5. NEVER pretend to be a monolingual English speaker.
            
            IMPORTANT: If you receive a system instruction about speed (e.g., "[SYSTEM: ...]), ADAPT IMMEDIATELY for the next sentence. Do not discuss the speed setting.

            Example:
            User (RU): Как будет "собака"?
            Model (RU): "Собака" по-английски будет "Dog". Попробуйте сказать: "I have a dog".`,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            
            if (!inputAudioContextRef.current || !streamRef.current) return;

            const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            inputSourceRef.current = source;
            
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              
              if (streamRef.current?.getAudioTracks()[0]?.enabled) {
                   setVolume(Math.min(rms * 5, 1)); 
              }

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Check turn completion
            if (message.serverContent?.turnComplete) {
                 processingModelTurnRef.current = false;
                 
                 // If we were ignoring this turn (control message), reset the flag
                 if (ignoringNextTurnRef.current) {
                     ignoringNextTurnRef.current = false;
                 }

                 // Standard logic: If no active audio is playing, unmute immediately
                 // (Though typically turnComplete happens after the USER speaks, so we MUTE)
                 // WAIT: turnComplete is sent by server when SERVER is done? No.
                 // In Gemini Live API, turnComplete usually signals the end of the USER's turn being processed?
                 // Actually, for Live API, turnComplete often means the model has finished its response generation.
                 
                 // However, for the "Walkie-Talkie" logic requested:
                 // "Automatically apply mute to my mic if I finished speaking."
                 // The Model detects the end of user speech (VAD).
                 
                 // If the message contains `interrupted`, it means the user spoke.
            }
            
            // Handle Transcription (filtering out control messages)
            if (!ignoringNextTurnRef.current) {
                if (onTranscriptionUpdate) {
                    if (message.serverContent?.outputTranscription?.text) {
                        onTranscriptionUpdate('', message.serverContent.outputTranscription.text);
                    } else if (message.serverContent?.inputTranscription?.text) {
                        onTranscriptionUpdate(message.serverContent.inputTranscription.text, '');
                    }
                }
            }

            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                if (ignoringNextTurnRef.current) {
                    // Silently discard this audio chunk (it's likely "Okay" or "Understood")
                    return;
                }

                if (outputAudioContextRef.current && outputNodeRef.current) {
                    // 1. Audio incoming -> Mute mic to prevent echo/feedback
                    // The model is starting to speak (or streaming chunks).
                    if (!isMuted) {
                        setMediaMute(true); 
                    }
                    
                    processingModelTurnRef.current = true;
                    setIsPlaying(true);

                    const ctx = outputAudioContextRef.current;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                    
                    const audioBuffer = await decodeAudioData(
                        decode(base64Audio),
                        ctx,
                        24000,
                        1
                    );

                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputNodeRef.current);
                    
                    source.addEventListener('ended', () => {
                        activeSourcesRef.current.delete(source);
                        // Check if queue is empty
                        if (activeSourcesRef.current.size === 0) {
                            setIsPlaying(false);
                            // Do NOT automatically unmute here. 
                            // The user requested: "Mic icon shows muted. I click it to speak."
                            // But also: "Automatically mute if I finished speaking."
                            // Logic:
                            // 1. User speaks -> Silence -> Model speaks (Mic Muted)
                            // 2. Model finishes -> Mic stays Muted? Or Mic opens?
                            // User said: "Микрофон должен начинать меня слушать сразу после окончания ответа нейросети"
                            // (Mic should start listening immediately after AI finishes answer)
                            
                            // So:
                            if (!processingModelTurnRef.current) {
                                setMediaMute(false); // Open mic automatically when AI finishes
                            }
                        }
                    });

                    source.start(nextStartTimeRef.current);
                    activeSourcesRef.current.add(source);
                    nextStartTimeRef.current += audioBuffer.duration;
                }
            }

            // Server-side turn completion or interruption
            if (message.serverContent?.interrupted) {
                stopAudioPlayback();
                setMediaMute(false); // User interrupted, so ensure mic is open
            }
            
            // Explicit turnComplete usually comes at end of generation
            if (message.serverContent?.turnComplete) {
                // If queue is empty, we can unmute
                if (activeSourcesRef.current.size === 0) {
                     setMediaMute(false);
                }
            }
          },
          onclose: () => {
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error(err);
            setErrorMessage("Ошибка соединения.");
            setConnectionState(ConnectionState.ERROR);
            cleanup();
          }
        },
        config: config.config as any
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (error: any) {
      setErrorMessage(error.message);
      setConnectionState(ConnectionState.ERROR);
      cleanup();
    }
  }, [cleanup, onTranscriptionUpdate, stopAudioPlayback, setMediaMute]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // The Big Button Logic
  const toggleMute = useCallback(() => {
    // 1. If AI is speaking (Playing), this is an INTERRUPT.
    if (activeSourcesRef.current.size > 0 || isPlaying) {
        stopAudioPlayback(); // Immediate silence
        setMediaMute(false); // Immediate mic open
        return;
    }

    // 2. If AI is silent, this is a standard Mic Toggle.
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const isCurrentlyEnabled = audioTracks[0].enabled;
        // If enabled (true), we want to MUTE (false).
        // If disabled (false/muted), we want to UNMUTE (true).
        setMediaMute(isCurrentlyEnabled); 
      }
    }
  }, [stopAudioPlayback, setMediaMute, isPlaying]);

  return {
    connect,
    disconnect,
    toggleMute,
    isMuted,
    connectionState,
    errorMessage,
    volume,
    sendTextMessage,
    sendControlMessage,
    isPlaying
  };
};