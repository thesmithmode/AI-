import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState } from '../types';
import { decode, decodeAudioData, createBlob } from '../utils/audio-utils';

interface UseLiveAPIProps {
  onTranscriptionUpdate?: (user: string, model: string) => void;
  audioSpeed: number;
}

export const useLiveAPI = ({ onTranscriptionUpdate, audioSpeed }: UseLiveAPIProps) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(0); // 0 to 1 normalized volume for visualizer

  // Audio Contexts and Nodes
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Playback Queue Management
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // API Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Speed control ref
  const audioSpeedRef = useRef(audioSpeed);

  useEffect(() => {
    audioSpeedRef.current = audioSpeed;
  }, [audioSpeed]);

  const cleanup = useCallback(() => {
    // Stop all active sources
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { /* ignore */ }
    });
    activeSourcesRef.current.clear();

    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop Microphone Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close Session (if possible, though logic relies on connection drop mostly)
    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => {
            if(session.close) session.close();
        }).catch(() => {});
        sessionPromiseRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setVolume(0);
    nextStartTimeRef.current = 0;
  }, []);

  const connect = useCallback(async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      setErrorMessage(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      // Setup Output Node
      const outputNode = outputCtx.createGain();
      outputNode.connect(outputCtx.destination);
      outputNodeRef.current = outputNode;

      // Setup Visualizer Analyser
      const analyser = outputCtx.createAnalyser();
      analyser.fftSize = 256;
      outputNode.connect(analyser); // Connect output to analyser for visualizer
      analyserRef.current = analyser;

      // Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            // System instruction updated for strict bilingual support
            systemInstruction: `You are a professional bilingual language tutor. You are a native Russian speaker who is an expert in teaching English.

            CORE BEHAVIOR:
            1. LISTEN CAREFULLY to the language the user is speaking.
            2. IF USER SPEAKS RUSSIAN: You MUST respond in RUSSIAN. Explain concepts, translate, or answer questions in clear Russian. Then, prompt them to say the English equivalent.
            3. IF USER SPEAKS ENGLISH: Respond in English to maintain the flow of practice. Correct mistakes gently.
            4. IF USER ASKS "WHY ENGLISH?" OR IS CONFUSED: Explain in RUSSIAN that you are here to help them practice, but you understand Russian perfectly.
            5. NEVER pretend to be a monolingual English speaker. You are a teacher helping a Russian student.

            Example Interaction 1:
            User (RU): Как будет "собака"?
            Model (RU): "Собака" по-английски будет "Dog". Попробуйте сказать: "I have a dog".

            Example Interaction 2:
            User (RU): Почему ты отвечаешь на английском?
            Model (RU): Извините! Я думал, мы практикуемся. Я прекрасно говорю по-русски. Что бы вы хотели обсудить или перевести?

            Example Interaction 3:
            User (EN): Hello, how are you?
            Model (EN): I'm doing well, thank you! How are you today?`,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            
            // Setup Input Processing Pipeline
            if (!inputAudioContextRef.current || !streamRef.current) return;

            const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            inputSourceRef.current = source;
            
            // Use ScriptProcessor for capturing PCM data chunks
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              
              // Visualizer logic for input (simple volume check)
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(Math.min(rms * 5, 1)); // Amplify for visualizer

              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             // Handle Transcriptions
            if (onTranscriptionUpdate) {
                if (message.serverContent?.outputTranscription?.text) {
                    onTranscriptionUpdate('', message.serverContent.outputTranscription.text);
                } else if (message.serverContent?.inputTranscription?.text) {
                    onTranscriptionUpdate(message.serverContent.inputTranscription.text, '');
                }
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current && outputNodeRef.current) {
                const ctx = outputAudioContextRef.current;
                
                // Track start time
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    ctx,
                    24000,
                    1
                );

                const currentSpeed = audioSpeedRef.current;

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = currentSpeed;
                source.connect(outputNodeRef.current);
                
                source.addEventListener('ended', () => {
                    activeSourcesRef.current.delete(source);
                });

                source.start(nextStartTimeRef.current);
                activeSourcesRef.current.add(source);
                
                // Adjust duration based on speed
                nextStartTimeRef.current += audioBuffer.duration / currentSpeed;
            }

            // Handle Interruptions
            if (message.serverContent?.interrupted) {
                activeSourcesRef.current.forEach(src => {
                    try { src.stop(); } catch(e) {}
                });
                activeSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("Gemini Live API Error:", err);
            setErrorMessage("Ошибка соединения. Пожалуйста, попробуйте снова.");
            setConnectionState(ConnectionState.ERROR);
            cleanup();
          }
        },
        config: config.config as any // Casting due to potential strict typing issues with specific SDK versions
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (error: any) {
      console.error("Connection setup failed:", error);
      setErrorMessage(error.message || "Не удалось получить доступ к микрофону.");
      setConnectionState(ConnectionState.ERROR);
      cleanup();
    }
  }, [cleanup, onTranscriptionUpdate]);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // Animation frame loop for output volume visualizer
  useEffect(() => {
    let animationFrameId: number;
    
    const updateVisualizer = () => {
      if (analyserRef.current && connectionState === ConnectionState.CONNECTED) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume from output
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // If output is silent, volume might still be driven by input in onaudioprocess
        // Only override if output is loud enough to matter
        if (avg > 10) { 
             setVolume(Math.min(avg / 128, 1));
        }
      }
      animationFrameId = requestAnimationFrame(updateVisualizer);
    };
    
    updateVisualizer();
    return () => cancelAnimationFrame(animationFrameId);
  }, [connectionState]);

  return {
    connect,
    disconnect,
    connectionState,
    errorMessage,
    volume
  };
};