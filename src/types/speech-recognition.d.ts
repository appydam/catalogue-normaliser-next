// Web Speech API — webkit prefix + missing event types
interface Window {
  webkitSpeechRecognition: typeof SpeechRecognition;
}

// SpeechRecognitionEvent may not be in all TS libs
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
