
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export enum TurnState {
  USER_SPEAKING = 'USER_SPEAKING', // User is talking, we are sending audio
  AI_PROCESSING = 'AI_PROCESSING', // User finished, waiting for response
  AI_SPEAKING = 'AI_SPEAKING'      // AI is playing audio, mic is suppressed
}

export type SpeedMode = 'v-slow' | 'slow' | 'normal' | 'fast' | 'v-fast';
