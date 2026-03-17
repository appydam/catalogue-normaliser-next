"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechRecognitionOptions {
  lang?: string;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
}

// Use a loose type to avoid issues with missing Web Speech API types in some TS configs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionInstance = any;

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

/**
 * Hook for browser-native speech recognition.
 * Supports Hindi (hi-IN) and English (en-IN) — both common on Indian Android phones.
 *
 * Uses the Web Speech API (SpeechRecognition), which is supported in:
 * - Chrome (desktop + Android) — covers ~85% of Indian smartphone users
 * - Safari (iOS 14.5+)
 * - Edge
 */
export function useSpeechRecognition({
  lang = "en-IN", // English (India) — understands Indian accent, Hindi words get translated downstream
  onResult,
  onError,
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false); // false on SSR, updated after mount
  const recognitionRef = useRef<SpeechRecognitionInstance>(null);

  useEffect(() => {
    setIsSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  const startListening = useCallback(() => {
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      onError?.("Speech recognition is not supported in this browser");
      return;
    }

    // Stop any existing instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new Constructor();

    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const current = finalTranscript || interimTranscript;
      setTranscript(current);

      if (finalTranscript) {
        onResult?.(finalTranscript);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error !== "aborted") {
        onError?.(event.error === "not-allowed"
          ? "Microphone access denied. Please allow microphone access."
          : `Speech recognition error: ${event.error}`
        );
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setTranscript("");
  }, [isSupported, lang, onResult, onError]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    transcript,
    startListening,
    stopListening,
  };
}
