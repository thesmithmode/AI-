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
  
  // API Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const cleanup = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    activeSourcesRef.current.clear();

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
    if (outputAudioContextRef.current) {
        activeSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) { /* ignore */ }
        });
        activeSourcesRef.current.clear();
        nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
        processingModelTurnRef.current = false;
    }
  }, []);

  const sendTextMessage = useCallback((text: string) => {
      if (sessionPromiseRef.current) {
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
            if (onTranscriptionUpdate) {
                if (message.serverContent?.outputTranscription?.text) {
                    onTranscriptionUpdate('', message.serverContent.outputTranscription.text);
                } else if (message.serverContent?.inputTranscription?.text) {
                    onTranscriptionUpdate(message.serverContent.inputTranscription.text, '');
                }
            }

            if (message.serverContent?.turnComplete) {
                 processingModelTurnRef.current = false;
                 // If no active audio is playing, unmute immediately
                 if (activeSourcesRef.current.size === 0) {
                     setMediaMute(false);
                 }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current && outputNodeRef.current) {
                // Audio incoming -> Mute mic to prevent echo/feedback during playback
                // and to follow "Mic starts listening AFTER answer" rule
                setMediaMute(true);
                processingModelTurnRef.current = true;

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
                    // If this was the last source AND the model is done generating, unmute
                    if (activeSourcesRef.current.size === 0 && !processingModelTurnRef.current) {
                        setMediaMute(false);
                    }
                });

                source.start(nextStartTimeRef.current);
                activeSourcesRef.current.add(source);
                nextStartTimeRef.current += audioBuffer.duration;
            }

            if (message.serverContent?.interrupted) {
                stopAudioPlayback();
                // If interrupted, we assume user wants to speak, so ensure unmute
                setMediaMute(false);
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

  const toggleMute = useCallback(() => {
    // If currently playing audio, this button acts as INTERRUPT
    if (activeSourcesRef.current.size > 0) {
        stopAudioPlayback();
        setMediaMute(false); // Enable mic to talk
        // Send a text signal to clear model context? Usually sending audio is enough.
        return;
    }

    // Normal Mute Toggle
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const isCurrentlyEnabled = audioTracks[0].enabled;
        setMediaMute(isCurrentlyEnabled); // If enabled (true), mute it (false).
      }
    }
  }, [stopAudioPlayback, setMediaMute]);

  useEffect(() => {
    let animationFrameId: number;
    const updateVisualizer = () => {
      if (analyserRef.current && connectionState === ConnectionState.CONNECTED) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        if (avg > 10) setVolume(Math.min(avg / 128, 1));
      }
      animationFrameId = requestAnimationFrame(updateVisualizer);
    };
    updateVisualizer();
    return () => cancelAnimationFrame(animationFrameId);
  }, [connectionState]);

  return {
    connect,
    disconnect,
    toggleMute,
    isMuted,
    connectionState,
    errorMessage,
    volume,
    sendTextMessage,
    isPlaying: activeSourcesRef.current.size > 0
  };
};