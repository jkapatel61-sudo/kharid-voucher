import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Volume2, AlertCircle, X } from 'lucide-react';
import { Product } from '../types';
import { parseVoiceBillingCommand, checkSpeechRecognitionSupport } from '../utils/voiceBilling';

interface VoiceBillingBarProps {
  cleanProducts: Product[];
  activeProductIds: string[];
  customerName: string;
  resetKey?: number;
  onSelectProduct: (p: Product) => void;
  onSetCustomerName: (name: string) => void;
  onSetWeightAndRate: (productId: string, weight?: number, rate?: number) => void;
  onVoiceSaveAndPrint: (
    overrideProduct?: Product,
    overrideCustomerName?: string,
    overrideWeight?: number,
    overrideRate?: number
  ) => void;
}

// Gentle audio confirmation chime using Web Audio API
const playVoiceChime = (type: 'beep' | 'success') => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'beep') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else {
      // 2-tone pleasant success chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Ignore audio failures if restricted
  }
};

export const VoiceBillingBar: React.FC<VoiceBillingBarProps> = ({
  cleanProducts,
  activeProductIds,
  customerName,
  resetKey,
  onSelectProduct,
  onSetCustomerName,
  onSetWeightAndRate,
  onVoiceSaveAndPrint,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSupported = checkSpeechRecognitionSupport();

  // Reference to SpeechRecognition instance
  const recognitionRef = useRef<any>(null);
  const isTriggeringPrintRef = useRef(false);

  // Keep references to latest props to prevent stale closures
  const activeProductIdsRef = useRef(activeProductIds);
  activeProductIdsRef.current = activeProductIds;

  const cleanProductsRef = useRef(cleanProducts);
  cleanProductsRef.current = cleanProducts;

  // Clear voice box and stop recognition immediately when bill is saved
  useEffect(() => {
    if (resetKey !== undefined && resetKey > 0) {
      setTranscript('');
      setErrorMessage(null);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
    }
  }, [resetKey]);

  // When customerName is empty and no products selected (clean slate for new bill), clear old transcript
  useEffect(() => {
    if (!customerName && activeProductIds.length === 0) {
      setTranscript('');
    }
  }, [customerName, activeProductIds.length]);

  const handleVoiceResult = useCallback(
    (spokenText: string) => {
      setTranscript(spokenText);
      setErrorMessage(null);

      // Find current active product
      const activePId = activeProductIdsRef.current[0];
      const currentActiveProd = cleanProductsRef.current.find((p) => p.id === activePId);

      const parsed = parseVoiceBillingCommand(
        spokenText,
        cleanProductsRef.current,
        currentActiveProd
      );

      let targetProduct = parsed.matchedProduct || currentActiveProd;

      // If user named an item and it wasn't selected, select it
      if (parsed.matchedProduct && (!currentActiveProd || currentActiveProd.id !== parsed.matchedProduct.id)) {
        onSelectProduct(parsed.matchedProduct);
        targetProduct = parsed.matchedProduct;
      }

      // If user spoke a customer name
      if (parsed.customerName && parsed.customerName.trim().length >= 2) {
        onSetCustomerName(parsed.customerName.trim());
      }

      // If user spoke weight or rate
      if (targetProduct && (parsed.weightKg !== undefined || parsed.ratePer20Kg !== undefined)) {
        onSetWeightAndRate(targetProduct.id, parsed.weightKg, parsed.ratePer20Kg);
      }

      // If user said "પ્રિન્ટ"
      if (parsed.isPrintTriggered && !isTriggeringPrintRef.current) {
        isTriggeringPrintRef.current = true;
        playVoiceChime('success');

        setTimeout(() => {
          onVoiceSaveAndPrint(
            targetProduct,
            parsed.customerName,
            parsed.weightKg,
            parsed.ratePer20Kg
          );
          isTriggeringPrintRef.current = false;
          setTranscript('');
          if (recognitionRef.current) {
            try {
              recognitionRef.current.stop();
            } catch {}
          }
          setIsListening(false);
        }, 350);
      }
    },
    [onSelectProduct, onSetCustomerName, onSetWeightAndRate, onVoiceSaveAndPrint]
  );

  // Auto clear error message after 7 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const startListening = async () => {
    setErrorMessage(null);
    if (!isSupported) {
      setErrorMessage('તમારા બ્રાઉઝરમાં માઇક્રોફોન સપોર્ટ નથી. કૃપા કરીને Google Chrome વાપરો.');
      return;
    }

    // First explicitly request microphone permission via getUserMedia
    // so mobile browsers show the native permission prompt
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: any) {
        const isIframe = typeof window !== 'undefined' && window.self !== window.top;
        if (isIframe) {
          setErrorMessage('સ્ટુડિયો પ્રિવ્યૂ સ્ક્રીનમાં માઇક બ્લોક છે. માઇક્રોફોન વાપરવા માટે એપને સીધા ક્રોમ બ્રાઉઝર (Chrome) માં ખોલો.');
        } else {
          setErrorMessage('બ્રાઉઝરમાં માઇક્રોફોન પરવાનગી બંધ છે. સાઇટ સેટિંગ્સમાંથી Mic Allow કરો.');
        }
        setIsListening(false);
        return;
      }
    }

    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      // Primary language Gujarati, will also understand English digits & terms
      recognition.lang = 'gu-IN';

      recognition.onstart = () => {
        setIsListening(true);
        setErrorMessage(null);
        setTranscript('');
        playVoiceChime('beep');
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        if (currentTranscript.trim()) {
          handleVoiceResult(currentTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          return;
        }
        if (event.error === 'not-allowed') {
          const isIframe = typeof window !== 'undefined' && window.self !== window.top;
          if (isIframe) {
            setErrorMessage('સ્ટુડિયો પ્રિવ્યૂ સ્ક્રીનમાં માઇક બ્લોક છે. માઇક્રોફોન વાપરવા માટે એપને સીધા ક્રોમ બ્રાઉઝર (Chrome) માં ખોલો.');
          } else {
            setErrorMessage('બ્રાઉઝરમાં માઇક્રોફોન પરવાનગી બંધ છે. સાઇટ સેટિંગ્સમાંથી Mic Allow કરો.');
          }
          setIsListening(false);
          return;
        }
        setErrorMessage(`માઈક ક્ષતિ: ${event.error || 'અવાજ પકડાયો નથી'}`);
      };

      recognition.onend = () => {
        // Keep listening unless user turned it off
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      setErrorMessage('માઇક શરૂ કરવામાં અસમર્થ: ' + (err?.message || ''));
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="bg-emerald-50/70 border border-emerald-200/90 rounded-2xl p-1.5 sm:p-2 shadow-2xs flex items-center gap-2">
        {/* ૧. ખાલી બોલવા માટે ગ્રીન સિમ્બોલ */}
        <button
          type="button"
          id="toggle-voice-billing-btn"
          onClick={isListening ? stopListening : startListening}
          className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition shadow-xs active:scale-95 cursor-pointer shrink-0 ${
            isListening
              ? 'bg-emerald-600 text-white ring-4 ring-emerald-400/60 animate-pulse'
              : 'bg-emerald-700 hover:bg-emerald-800 text-white'
          }`}
          title={isListening ? 'માઈક બંધ કરો' : 'બોલવા માટે માઈક દબાવો'}
        >
          {isListening ? (
            <div className="relative flex items-center justify-center">
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping"></span>
              <Mic className="w-5 h-5 sm:w-5.5 sm:h-5.5 text-white" />
            </div>
          ) : (
            <Mic className="w-5 h-5 sm:w-5.5 sm:h-5.5 text-white" />
          )}
        </button>

        {/* બોલીને આવે તે લખાણ */}
        <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 sm:py-2 flex items-center gap-2 shadow-2xs min-h-[38px] sm:min-h-[42px]">
          <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
          <div className="text-xs sm:text-sm font-semibold truncate text-slate-800 flex-1">
            {transcript ? (
              <span className="font-black text-emerald-950 text-xs sm:text-sm">{transcript}</span>
            ) : isListening ? (
              <span className="text-emerald-700 animate-pulse font-medium text-xs sm:text-sm">
                બોલો...
              </span>
            ) : null}
          </div>
          {transcript && (
            <button
              type="button"
              onClick={() => setTranscript('')}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition cursor-pointer shrink-0"
              title="લખાણ સાફ કરો"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error message with dismiss button */}
      {errorMessage && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center justify-between gap-1.5 font-bold shadow-2xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 hover:bg-rose-100 rounded-lg text-rose-500 hover:text-rose-700 shrink-0 cursor-pointer"
            title="બંધ કરો"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
