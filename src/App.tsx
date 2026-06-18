import React, { useState, useEffect, useRef } from "react";
import { 
  Mic, 
  MicOff, 
  Radio, 
  Users, 
  Languages, 
  Copy, 
  Check, 
  Volume2, 
  VolumeX, 
  LogOut, 
  Sparkles, 
  Globe, 
  AlertCircle,
  HelpCircle,
  TrendingUp,
  Info,
  Video,
  ExternalLink,
  MessageSquare
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// List of supported translation languages
const LANGUAGES = [
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵" },
  { code: "km", name: "Khmer", native: "ភាសាខ្មែរ", flag: "🇰🇭" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "zh", name: "Mandarin Chinese", native: "中文 (普通话)", flag: "🇨🇳" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { code: "ko", name: "Korean", native: "한국어", flag: "🇰🇷" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", flag: "🇻🇳" },
  { code: "th", name: "Thai", native: "ไทย", flag: "🇹🇭" },
  { code: "en", name: "English", native: "English", flag: "🇺🇸" }
];

export default function App() {
  // Navigation & role allocation
  const [role, setRole] = useState<"select" | "speaker" | "attendee">("select");
  const [roomId, setRoomId] = useState("");
  const [targetLang, setTargetLang] = useState("es");
  const [isCopied, setIsCopied] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Connection & audio state
  const [isConnected, setIsConnected] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    speakerConnected: false,
    attendeeCount: 0,
    statusMessage: "Disconnected"
  });

  // Transcript states
  const [transcript, setTranscript] = useState("");
  const [transcriptHistory, setTranscriptHistory] = useState<string[]>([]);
  const [originalTranscript, setOriginalTranscript] = useState("");
  const [originalTranscriptHistory, setOriginalTranscriptHistory] = useState<string[]>([]);

  // Text-to-text translation Fallback console states
  const [typedText, setTypedText] = useState("");
  const [translatedTextResult, setTranslatedTextResult] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [textTranslationHistory, setTextTranslationHistory] = useState<Array<{
    original: string;
    translated: string;
    sender: string;
    timestamp: string;
    targetLang: string;
  }>>([]);

  // Google Meet active integration states
  const [meetLink, setMeetLink] = useState("");
  const [isMeetGenerating, setIsMeetGenerating] = useState(false);
  const [customMeetLinkInput, setCustomMeetLinkInput] = useState("");
  
  // Speaker state
  const [isMuted, setIsMuted] = useState(false);
  const [micVolume, setMicVolume] = useState(0); // Real-time volume levels for circular reactive rings
  const [detectedLanguage, setDetectedLanguage] = useState<string>("English");
  const [speakingLanguage, setSpeakingLanguage] = useState<string>("auto");
  const [activeTab, setActiveTab] = useState<"studio" | "tools">("studio");
  const [showEndConfirm, setShowEndConfirm] = useState<boolean>(false);

  // Attendee state
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);

  // References for low-latency WebSockets & Web Audio nodes
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  // User ID to handle multi-speaker and avoid loopback echo
  const [userId] = useState(() => "user_" + Math.random().toString(36).substring(2, 9));
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const broadcastWSRef = useRef<WebSocket | null>(null);
  const broadcastStreamRef = useRef<MediaStream | null>(null);
  const broadcastAudioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const broadcastAudioContextRef = useRef<AudioContext | null>(null);
  
  // Check if roomId is present in the URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    if (roomFromUrl) {
      setRoomId(roomFromUrl);
      setRole("attendee");
    } else {
      // Pre-generate a standard short random Room ID for a new Speaker
      setRoomId(Math.random().toString(36).substring(2, 7).toUpperCase());
    }
  }, []);

  // Update URL to make sharing seamless
  const getShareUrl = () => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${roomId}`;
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(getShareUrl());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const changeAttendeeLanguage = (newLang: string) => {
    setTargetLang(newLang);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "change-language",
        lang: newLang
      }));
    }
  };

  const selectSpeakingLanguage = (langCode: string) => {
    setSpeakingLanguage(langCode);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "change-speaking-language",
        languageCode: langCode
      }));
    }
  };

  // Send Typed Text Translation Request over WebSocket
  const sendTextTranslation = () => {
    if (!typedText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setIsTranslating(true);
    wsRef.current.send(JSON.stringify({
      type: "text-translate",
      text: typedText.trim(),
      targetLang: targetLang
    }));
    setTypedText("");
  };

  // Broadcast or Sync Google Meet room link across WebSocket
  const submitCustomMeetLink = (urlStr?: string) => {
    const linkToSend = urlStr !== undefined ? urlStr : customMeetLinkInput.trim();
    setMeetLink(linkToSend);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "set-meet-link",
        link: linkToSend
      }));
    }
  };

  // Google Meet API calling flow using dynamic GSI integration
  const generateMeetSpace = async () => {
    setIsMeetGenerating(true);
    setErrorText(null);
    try {
      const gClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
        client_id: "753238515250-default.apps.googleusercontent.com",
        scope: "https://www.googleapis.com/auth/meetings.space.created https://www.googleapis.com/auth/meetings.space.readonly",
        callback: async (tokenResponse: any) => {
          if (tokenResponse.error) {
            setErrorText("Google Authentication failed: " + tokenResponse.error);
            setIsMeetGenerating(false);
            return;
          }
          const accessToken = tokenResponse.access_token;
          try {
            const res = await fetch("/api/create-meet", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              }
            });
            const data = await res.json();
            if (data.meetingUri) {
              setCustomMeetLinkInput(data.meetingUri);
              setMeetLink(data.meetingUri);
              // Broadcast it
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: "set-meet-link",
                  link: data.meetingUri
                }));
              }
            } else {
              setErrorText(data.error || "Failed to retrieve Google Meet space link. Please try again.");
            }
          } catch (e: any) {
            setErrorText("Failed to contact Meet creator bridge: " + e.message);
          } finally {
            setIsMeetGenerating(false);
          }
        },
      });

      if (gClient) {
        gClient.requestAccessToken({ prompt: "consent" });
      } else {
        // Dynamically load Google Identity Service script
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.onload = () => {
          generateMeetSpace();
        };
        document.body.appendChild(script);
      }
    } catch (err: any) {
      console.error(err);
      setErrorText("Google popup blocked. Please allow popups for this site.");
      setIsMeetGenerating(false);
    }
  };

  // --- SPEAKER CODE: MIC CAPTURE & AUDIO CONVERSION ---
  const startSpeakerBroadcast = async () => {
    setErrorText(null);
    try {
      // 1. Get access to the speaker's microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 2. Establish connection to our Express/Vite secure backend WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws?role=speaker&roomId=${roomId}&speakingLang=${speakingLanguage}&userId=${userId}`;
      
      console.log("Connecting speaker to WebSocket url:", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setSystemStatus(prev => ({ ...prev, statusMessage: "Live Broadcast Started" }));
        initSpeakerAudioProcessing(stream);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "system") {
          setSystemStatus(prev => ({
            ...prev,
            speakerConnected: msg.speakerConnected,
            attendeeCount: msg.attendeeCount
          }));
          if (msg.speakingLanguageCode) {
            setSpeakingLanguage(msg.speakingLanguageCode);
          }
          if (msg.meetLink) {
            setMeetLink(msg.meetLink);
            setCustomMeetLinkInput(msg.meetLink);
          } else {
            setMeetLink("");
          }
        } else if (msg.type === "speaker-language") {
          setDetectedLanguage(msg.language);
          if (msg.originalText) {
            const newOriginal = msg.originalText.trim();
            if (newOriginal) {
              setOriginalTranscript(newOriginal);
              if (newOriginal.match(/[.!?]$/) || newOriginal.length > 50) {
                setOriginalTranscriptHistory(prev => {
                  if (prev[prev.length - 1] === newOriginal) return prev;
                  return [...prev, newOriginal].slice(-10);
                });
              }
            }
          }
        } else if (msg.type === "text-translation-result") {
          setTranslatedTextResult(msg.translatedText);
          setIsTranslating(false);
          setTextTranslationHistory(prev => [
            ...prev,
            {
              original: msg.originalText,
              translated: msg.translatedText,
              sender: msg.sender,
              timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              targetLang: msg.targetLang
            }
          ].slice(-20));
        } else if (msg.type === "error") {
          setErrorText(msg.message);
          stopBroadcast();
        }
      };

      ws.onclose = () => {
        stopBroadcast();
      };

      ws.onerror = (err) => {
        console.error("Speaker WebSocket general error:", err);
        setErrorText("Network connection issues. Try restarting.");
        stopBroadcast();
      };

    } catch (err: any) {
      console.error("Encountered microphone or permission block:", err);
      setErrorText("Microphone permission denied or source unavailable.");
      stopBroadcast();
    }
  };

  const initSpeakerAudioProcessing = (stream: MediaStream) => {
    // Standardize across browsers with low-latency configuration
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass({ latencyHint: "interactive" });
    
    // Wake up AudioContext on standard user click gesture
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    
    // Process stream in 2048-sample buffer arrays for ultra low-latency real-time response
    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    audioProcessorRef.current = processor;

    source.connect(processor);
    processor.connect(audioContext.destination);

    // Capture microphone input rate dynamically to downsample accurately
    const inputSampleRate = audioContext.sampleRate;

    processor.onaudioprocess = (e) => {
      // Skip processing/sending of frames if muted
      if (isMuted) {
        setMicVolume(0);
        return;
      }

      const inputBufferFloat32 = e.inputBuffer.getChannelData(0);

      // Measure volume amplitude for voice level meter animations
      let sum = 0;
      for (let i = 0; i < inputBufferFloat32.length; i++) {
        sum += inputBufferFloat32[i] * inputBufferFloat32[i];
      }
      const rootMeanSquare = Math.sqrt(sum / inputBufferFloat32.length);
      setMicVolume(Math.min(100, Math.round(rootMeanSquare * 350)));

      // Resample down to 16kHz & convert payload to 16-bit Int16 PCM
      const downsampledBuffer = downsampleBuffer(inputBufferFloat32, inputSampleRate, 16000);
      const base64PCM = int16ToBase64(downsampledBuffer);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "audio",
          data: base64PCM
        }));
      }
    };
  };

  // Resamples a Float32Array to raw 16-bit PCM little-endian Int16Array
  const downsampleBuffer = (buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Int16Array => {
    if (inputSampleRate === outputSampleRate) {
      return floatTo16BitPCM(buffer);
    }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = Math.min(1, Math.max(-1, accum / (count || 1))) * 0x7FFF;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  const floatTo16BitPCM = (buffer: Float32Array): Int16Array => {
    const l = buffer.length;
    const buf = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      buf[i] = Math.min(1, Math.max(-1, buffer[i])) * 0x7FFF;
    }
    return buf;
  };

  const int16ToBase64 = (int16Array: Int16Array): string => {
    const buffer = int16Array.buffer;
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };


  // --- ATTENDEE CODE: STREAM PLAYBACK & TRANSCRIPT ---
  const startAttendeeSession = () => {
    setErrorText(null);
    setTranscript("");
    setTranscriptHistory([]);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?role=attendee&roomId=${roomId.trim().toUpperCase()}&lang=${targetLang}&userId=${userId}`;
    
    console.log("Connecting attendee to WebSocket url:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Initialize 24kHz audio context for translated speech playback (Gemini outputs 24kHz)
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const playCtx = new AudioContextClass({ sampleRate: 24000, latencyHint: "interactive" });
    
    // Wake up playback context on user click gesture
    if (playCtx.state === "suspended") {
      playCtx.resume();
    }
    
    playAudioContextRef.current = playCtx;
    nextStartTimeRef.current = playCtx.currentTime;

    ws.onopen = () => {
      setIsConnected(true);
      setSystemStatus(prev => ({ ...prev, statusMessage: "Connected to Translation Room" }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === "system") {
        setSystemStatus(prev => ({
          ...prev,
          speakerConnected: msg.speakerConnected,
          attendeeCount: msg.attendeeCount
        }));
        if (msg.meetLink) {
          setMeetLink(msg.meetLink);
        } else {
          setMeetLink("");
        }
      } else if (msg.type === "speaker-language") {
        setDetectedLanguage(msg.language);
        if (msg.originalText) {
          const newOriginal = msg.originalText.trim();
          if (newOriginal) {
            setOriginalTranscript(newOriginal);
            setOriginalTranscriptHistory(prev => {
              if (prev[prev.length - 1] === newOriginal) return prev;
              return [...prev, newOriginal].slice(-10);
            });
          }
        }
      } else if (msg.type === "status") {
        setSystemStatus(prev => ({ ...prev, statusMessage: msg.message }));
      } else if (msg.type === "audio") {
        if (isAudioEnabled && playAudioContextRef.current) {
          playTranslatedAudioChunk(msg.data);
        }
      } else if (msg.type === "text-translation-result") {
        setTranslatedTextResult(msg.translatedText);
        setIsTranslating(false);
        setTextTranslationHistory(prev => [
          ...prev,
          {
            original: msg.originalText,
            translated: msg.translatedText,
            sender: msg.sender,
            timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            targetLang: msg.targetLang
          }
        ].slice(-20));
      } else if (msg.type === "transcription") {
        // Feed live translated transcription
        const newText = msg.text.trim();
        if (newText) {
          setTranscript(newText);
          setTranscriptHistory(prev => {
            if (prev[prev.length - 1] === newText) return prev;
            return [...prev, newText].slice(-10); // Keep last 10 sentences
          });
        }
      } else if (msg.type === "interrupted") {
        // Skip current remaining scheduled playback chunks because model speaker was interrupted
        nextStartTimeRef.current = playAudioContextRef.current ? playAudioContextRef.current.currentTime : 0;
      } else if (msg.type === "error") {
        setErrorText(msg.message);
        disconnectAttendee();
      }
    };

    ws.onclose = () => {
      disconnectAttendee();
    };

    ws.onerror = (err) => {
      console.error("Attendee Web Socket Error:", err);
      setErrorText("Connection dropped. Please retry.");
      disconnectAttendee();
    };
  };

  const playTranslatedAudioChunk = (base64Audio: string) => {
    try {
      const ctx = playAudioContextRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      // Decode base64 back into raw float data
      const binary = window.atob(base64Audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x7FFF;
      }

      // Prepare playable audio buffer
      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(ctx.destination);

      // Schedule gapless transitions
      const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
      sourceNode.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;
    } catch (err) {
      console.error("Audio playback frame failure:", err);
    }
  };


  // --- DISCONNECTION & CLEANUP FUNCTIONS ---
  const stopBroadcast = () => {
    setIsConnected(false);
    setMicVolume(0);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const disconnectAttendee = () => {
    setIsConnected(false);
    setIsBroadcasting(false);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (playAudioContextRef.current) {
      playAudioContextRef.current.close();
      playAudioContextRef.current = null;
    }
    // Clean up active broadcast mic as well
    if (broadcastWSRef.current) {
      broadcastWSRef.current.close();
      broadcastWSRef.current = null;
    }
    if (broadcastAudioProcessorRef.current) {
      broadcastAudioProcessorRef.current.disconnect();
      broadcastAudioProcessorRef.current = null;
    }
    if (broadcastAudioContextRef.current) {
      broadcastAudioContextRef.current.close();
      broadcastAudioContextRef.current = null;
    }
    if (broadcastStreamRef.current) {
      broadcastStreamRef.current.getTracks().forEach(track => track.stop());
      broadcastStreamRef.current = null;
    }
  };

  const toggleDiscussionMic = async () => {
    if (isBroadcasting) {
      // Turn OFF broadcast
      setIsBroadcasting(false);
      if (broadcastWSRef.current) {
        broadcastWSRef.current.close();
        broadcastWSRef.current = null;
      }
      if (broadcastAudioProcessorRef.current) {
        broadcastAudioProcessorRef.current.disconnect();
        broadcastAudioProcessorRef.current = null;
      }
      if (broadcastAudioContextRef.current) {
        broadcastAudioContextRef.current.close();
        broadcastAudioContextRef.current = null;
      }
      if (broadcastStreamRef.current) {
        broadcastStreamRef.current.getTracks().forEach(track => track.stop());
        broadcastStreamRef.current = null;
      }
    } else {
      // Turn ON broadcast
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        broadcastStreamRef.current = stream;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        // Connect to speaker endpoint referencing auto-speaking language and standard room
        const wsUrl = `${protocol}//${host}/api/ws?role=speaker&roomId=${roomId.trim().toUpperCase()}&speakingLang=auto&userId=${userId}`;
        console.log("Discussion Mic connecting to WebSocket:", wsUrl);
        const ws = new WebSocket(wsUrl);
        broadcastWSRef.current = ws;

        ws.onopen = () => {
          setIsBroadcasting(true);
          
          // Setup audio context and downsampling for broadcast mic
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioContext = new AudioContextClass({ latencyHint: "interactive" });
          if (audioContext.state === "suspended") {
            audioContext.resume();
          }
          broadcastAudioContextRef.current = audioContext;

          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(2048, 1, 1);
          broadcastAudioProcessorRef.current = processor;

          source.connect(processor);
          processor.connect(audioContext.destination);

          const inputSampleRate = audioContext.sampleRate;

          processor.onaudioprocess = (e) => {
            const inputBufferFloat32 = e.inputBuffer.getChannelData(0);

            const downsampledBuffer = downsampleBuffer(inputBufferFloat32, inputSampleRate, 16000);
            const base64PCM = int16ToBase64(downsampledBuffer);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "audio",
                data: base64PCM,
                userId: userId
              }));
            }
          };
        };

        ws.onclose = () => {
          setIsBroadcasting(false);
        };

        ws.onerror = (err) => {
          console.error("Discussion Mic Socket Error:", err);
          setIsBroadcasting(false);
        };

      } catch (err) {
        console.error("Failed to capture microphone:", err);
        setErrorText("Microphone block or access error. Ensure permissions are granted.");
        setIsBroadcasting(false);
      }
    }
  };

  const leaveRoom = () => {
    setRole("select");
    stopBroadcast();
    disconnectAttendee();
    setTranscript("");
    setTranscriptHistory([]);
    setOriginalTranscript("");
    setOriginalTranscriptHistory([]);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] bg-[radial-gradient(rgba(255,255,255,0.012)_1px,transparent_1px)] [background-size:24px_24px] text-gray-200 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300 antialiased overflow-x-hidden relative">
      
      {/* Dynamic Background Noise/Glow effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950/5 via-[#0A0A0A] to-[#0A0A0A] pointer-events-none z-0" />
      
      {/* Premium Header */}
      <header className="border-b border-white/5 bg-[#0D0D0D]/80 backdrop-blur-md sticky top-0 z-50 transition-all">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={leaveRoom}>
            {isConnected && (
              <div className="relative flex items-center justify-center mr-1">
                <span className="absolute w-2.5 h-2.5 bg-red-500 rounded-full animate-ping opacity-75" />
                <span className="relative w-2.5 h-2.5 bg-red-500 rounded-full" />
              </div>
            )}
            {isConnected && (
              <div className="relative hidden sm:block">
                <span className="text-xs font-bold tracking-[0.2em] uppercase text-red-500 mr-2">Live Broadcast</span>
              </div>
            )}
            <h1 className="text-xl font-light tracking-tight text-white">
              Live<span className="font-bold text-red-500">Voice</span>
            </h1>
          </div>

          <div className="flex items-center gap-4">
            {isConnected ? (
              <div className="bg-white/5 border border-white/10 px-4 py-1.5 rounded-full flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-white/70">Room Code</span>
                <span className="text-sm font-mono text-emerald-400 font-bold uppercase tracking-tighter">{roomId || "default"}</span>
              </div>
            ) : (
              <div className="text-xs text-white/40 tracking-widest uppercase font-mono hidden sm:block">
                Zero-Latency Gateway
              </div>
            )}
            
            <a 
              href="https://github.com/bypeyovero/livevoice-live-translation"
              target="_blank"
              rel="noopener noreferrer" 
              className="text-[11px] font-bold uppercase tracking-widest text-white/60 hover:text-white transition-colors bg-white/5 border border-white/10 px-4 py-1.5 rounded-full"
            >
              Github
            </a>
          </div>
        </div>
      </header>

      {/* Main Content Stage */}
      <main className="flex-1 flex flex-col justify-center max-w-6xl w-full mx-auto px-6 py-12 z-10">
        
        {/* Error Banners */}
        <AnimatePresence>
          {errorText && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-8 overflow-hidden"
            >
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex gap-3 text-red-300 text-sm">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Operation Error</p>
                  <p className="opacity-90">{errorText}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 1. SELECTION SCREEN */}
        {role === "select" && (
          <div className="space-y-8 max-w-4xl mx-auto w-full">
            
            {/* Elegant Callout Hero */}
            <div className="text-center space-y-4 max-w-2xl mx-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1"
              >
                <Sparkles className="w-3 h-3 text-emerald-400" />
                REAL-TIME AI TRANSLATION
              </motion.div>
              <motion.h2 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl sm:text-5xl md:text-5xl font-extrabold tracking-tight text-white leading-tight"
              >
                Speak once. <br className="hidden sm:inline" /> Be heard in <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">every language</span>.
              </motion.h2>
              <motion.p 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-white/85 text-xs sm:text-sm leading-relaxed max-w-xl mx-auto"
              >
                Host a live audio room and let every listener hear the conversation in their preferred language, directly from their browser.
              </motion.p>
              
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11px] font-sans text-emerald-400/80 pt-1">
                <span>No app required</span>
                <span className="text-white/20">•</span>
                <span>Live audio and captions</span>
                <span className="text-white/20">•</span>
                <span>Multiple languages</span>
              </div>
            </div>

            {/* Split Roles Cards */}
            <div className="grid md:grid-cols-2 gap-6 pr-1">
              
              {/* Card Speaker */}
              <motion.div 
                whileHover={{ y: -4, scale: 1.01, boxShadow: "0 10px 25px -10px rgba(0,0,0,0.6)" }}
                className="bg-[#0D0D0D]/50 border border-white/5 rounded-2xl p-6 hover:bg-[#0D0D0D] hover:border-white/10 transition-all flex flex-col justify-between group cursor-pointer relative overflow-hidden h-full"
                onClick={() => setRole("speaker")}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-3xl pointer-events-none" />
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/70 group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-colors">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white group-hover:text-emerald-300 transition-colors">Start Live Broadcast</h3>
                    <p className="text-white/70 text-xs mt-2 leading-relaxed">
                      Create an audio room, speak directly into your microphone, and share your instant session Link or QR Code with listeners.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs font-mono">
                  <span className="text-white/45 uppercase tracking-widest text-[9px]">ROLE: PRIMARY SPEAKER</span>
                  <span className="px-3 py-1.5 rounded-full border border-white/5 bg-white/5 text-white/80 group-hover:text-emerald-400 group-hover:border-emerald-500/20 group-hover:bg-emerald-500/5 transition-all duration-300 flex items-center gap-1.5">
                    Create room <span className="transform group-hover:translate-x-1 transition-transform duration-300">&rarr;</span>
                  </span>
                </div>
              </motion.div>

              {/* Card Attendee */}
              <motion.div 
                whileHover={{ y: -4, scale: 1.01, boxShadow: "0 10px 25px -10px rgba(16,185,129,0.12)" }}
                className="bg-[#0D0D0D]/50 border border-emerald-500/20 rounded-2xl p-6 hover:bg-[#0D0D0D] hover:border-emerald-500/30 transition-all flex flex-col justify-between group cursor-pointer relative overflow-hidden h-full"
                onClick={() => setRole("attendee")}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-3xl pointer-events-none" />
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/5 border border-emerald-500/15 flex items-center justify-center text-emerald-400/80 group-hover:bg-emerald-500/10 group-hover:text-emerald-400 transition-colors animate-pulse">
                    <Languages className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white group-hover:text-emerald-300 transition-colors">Join an Existing Room</h3>
                    <p className="text-white/70 text-xs mt-2 leading-relaxed">
                      Enter a Broadcast Code, select your preferred target language, and hear the real-time spoken translation directly.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs font-mono">
                  <span className="text-emerald-400 uppercase tracking-widest text-[9px]">ROLE: ATTENDEE LISTENER</span>
                  <span className="px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 group-hover:text-white group-hover:border-emerald-400/30 group-hover:bg-emerald-500/10 transition-all duration-300 flex items-center gap-1.5">
                    Join room <span className="transform group-hover:translate-x-1 transition-transform duration-300">&rarr;</span>
                  </span>
                </div>
              </motion.div>

            </div>

            {/* Premium Trust line below cards */}
            <div className="text-center pt-2">
              <span className="text-white/60 text-xs tracking-wide">
                No installation required. Audio is processed securely and not stored after the session.
              </span>
            </div>

          </div>
        )}

        {/* 2. SPEAKER WORKSPACE PANEL */}
        {role === "speaker" && (
          <div className="max-w-4xl mx-auto w-full space-y-8">
            
            {/* Header Area */}
            <div className="flex items-center justify-between border-b border-white/5 pb-5">
              <div className="flex items-center gap-3">
                <button 
                  onClick={leaveRoom} 
                  className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 text-xs uppercase tracking-widest rounded-full transition-colors"
                >
                  &larr; Back
                </button>
                <h3 className="font-medium text-white text-lg">Speaker Studio</h3>
              </div>

              <div className="flex items-center gap-2.5 text-xs font-mono text-white/50">
                <span>Room Code: <span className="text-white font-semibold">{roomId.toUpperCase()}</span></span>
                {isConnected && (
                  <button 
                    onClick={handleCopyLink} 
                    className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-emerald-400 rounded-xl transition-all flex items-center gap-1.5 text-[10px] uppercase font-sans font-medium tracking-wider cursor-pointer"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{isCopied ? "Copied" : "Copy Link"}</span>
                  </button>
                )}
              </div>
            </div>

            {!isConnected ? (
              <div className="bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-8 space-y-6 text-center max-w-xl mx-auto">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mx-auto">
                  <Radio className="w-8 h-8 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-xl text-white">Configure Broadcast Room</h4>
                  <p className="text-white/80 text-sm leading-relaxed">
                    Review your room code below. Once launched, you can copy the shareable link or display its scan QR.
                  </p>
                </div>

                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-white/70 text-[10px] block mb-1.5 uppercase font-mono tracking-widest">Configure Room Code</label>
                    <input 
                      type="text" 
                      value={roomId} 
                      onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/\s/g, ""))}
                      placeholder="ENTER ROOM CODE" 
                      className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3 text-center text-white font-mono uppercase tracking-widest focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>

                  <button 
                    onClick={startSpeakerBroadcast}
                    className="w-full py-3.5 bg-white hover:bg-white/90 text-black text-[11px] font-bold uppercase tracking-widest rounded-full transition-all cursor-pointer shadow-lg font-mono"
                  >
                    Launch Live Broadcast Room
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Segment Interface Tabs */}
                <div className="flex border-b border-white/5 pb-px gap-2">
                  <button 
                    onClick={() => setActiveTab("studio")}
                    className={`px-6 py-3 text-xs uppercase tracking-widest font-bold tracking-wider font-mono border-b-2 transition-all ${
                      activeTab === "studio" 
                        ? "border-emerald-400 text-emerald-400 bg-white/2" 
                        : "border-transparent text-white/60 hover:text-white"
                    }`}
                  >
                    Studio Control
                  </button>
                  <button 
                    onClick={() => setActiveTab("tools")}
                    className={`px-6 py-3 text-xs uppercase tracking-widest font-bold tracking-wider font-mono border-b-2 transition-all relative ${
                      activeTab === "tools" 
                        ? "border-emerald-400 text-emerald-400 bg-white/2" 
                        : "border-transparent text-white/60 hover:text-white"
                    }`}
                  >
                    Meet & Messages
                    {meetLink && <span className="absolute top-2.5 right-2 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse border-2 border-black" />}
                  </button>
                </div>

                {activeTab === "studio" ? (
                  <div className="grid md:grid-cols-5 gap-8">
                    
                    {/* Visual Speaking Radar & Controls (Left 3 columns) */}
                    <div className="md:col-span-3 bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden md:min-h-[530px]">
                      <div className="absolute top-0 left-0 w-32 h-32 bg-emerald-500/5 blur-3xl pointer-events-none" />
                      
                      {/* Neon header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping absolute" />
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 relative" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">BROADCASTING LIVE</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-white/80 bg-black/30 px-3 py-1 border border-white/5 rounded-full">
                          <Users className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{systemStatus.attendeeCount} Listener{systemStatus.attendeeCount !== 1 && "s"}</span>
                        </div>
                      </div>

                      {/* Speaking Language Selector */}
                      <div className="bg-black/30 border border-white/5 py-2.5 px-4 rounded-xl flex items-center justify-between text-xs font-sans">
                        <span className="text-white/60 font-mono text-[10px] uppercase tracking-wider font-semibold">Speaking Language:</span>
                        <div className="flex items-center gap-2">
                          <select
                            value={speakingLanguage}
                            onChange={(e) => selectSpeakingLanguage(e.target.value)}
                            className="bg-[#0D0D0D] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-emerald-400 cursor-pointer font-medium tracking-wide transition-all"
                          >
                            <option value="auto">✨ Auto Detect</option>
                            <option value="en">🇬🇧 English</option>
                            <option value="zh">🇨🇳 Mandarin</option>
                            <option value="id">🇮🇩 Indonesian</option>
                            <option value="km">🇰🇭 Khmer</option>
                            <option value="ja">🇯🇵 Japanese</option>
                            <option value="es">🇪🇸 Spanish</option>
                          </select>
                        </div>
                      </div>

                      {/* Pulsing voice radar ring */}
                      <div className="py-2 flex flex-col items-center justify-center relative">
                        {/* Perfect centering container for the button and the rings */}
                        <div className="relative flex items-center justify-center w-52 h-52">
                          <div 
                            className="absolute rounded-full bg-emerald-500/5 border border-emerald-500/10 transition-all duration-75 animate-pulse"
                            style={{ 
                              width: `${110 + micVolume * 1.5}px`, 
                              height: `${110 + micVolume * 1.5}px`,
                              opacity: isMuted ? 0 : 1 
                            }}
                          />
                          <div 
                            className="absolute rounded-full bg-emerald-500/10 border border-emerald-500/20 transition-all duration-75"
                            style={{ 
                              width: `${150 + micVolume * 2.5}px`, 
                              height: `${150 + micVolume * 2.5}px`,
                              opacity: isMuted ? 0 : 0.8
                            }}
                          />
                          
                          <button 
                            onClick={() => setIsMuted(!isMuted)}
                            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all z-10 cursor-pointer shadow-xl ${
                              isMuted 
                                ? "bg-red-600 text-white shadow-red-600/20" 
                                : "bg-white text-black shadow-white/10 ring-4 ring-emerald-500/10"
                            }`}
                          >
                            {isMuted ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
                          </button>
                        </div>

                        {/* Interactive audio waveform (Requirement 3) */}
                        <div className="flex items-end justify-center gap-1.5 h-10 w-full mt-6 select-none pointer-events-none">
                          {Array.from({ length: 15 }).map((_, i) => {
                            const multiplier = [0.2, 0.4, 0.7, 0.9, 0.5, 0.8, 1.0, 0.9, 0.7, 0.4, 0.8, 0.5, 0.3, 0.6, 0.1][i];
                            const height = isMuted ? 4 : Math.max(4, Math.round(micVolume * multiplier * 0.45));
                            return (
                              <div 
                                key={i}
                                className={`w-1 rounded-full transition-all duration-75 ${isMuted ? "bg-white/10" : "bg-emerald-400"}`}
                                style={{ height: `${height}px` }}
                              />
                            );
                          })}
                        </div>

                        {/* Microphone Voice status line (Requirement 3) */}
                        <div className="mt-3 text-center">
                          <span className={`text-[11px] font-mono tracking-[0.2em] uppercase font-bold ${isMuted ? "text-red-500" : "text-white/80"}`}>
                            {isMuted ? "🔴 Microphone Muted" : "🟢 Microphone Active — Speaking"}
                          </span>
                        </div>

                        {/* Fixed Height Block to Lock layout and prevent scrolling/jumping (Requirement 20) */}
                        <div className="h-6 mt-1 flex items-center justify-center select-none overflow-hidden">
                          {!isMuted && micVolume > 10 ? (
                            <span className="text-[10px] text-emerald-400 font-mono tracking-wider animate-pulse flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                              SPOKEN VOICE DETECTED
                            </span>
                          ) : (
                            <span className="text-[10px] text-white/30 font-mono tracking-wider uppercase">
                              Waiting for voice...
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Safe End Session Area */}
                      <div className="pt-4 border-t border-white/5">
                        <button 
                          onClick={() => setShowEndConfirm(true)}
                          className="w-full h-11 px-6 rounded-xl bg-red-600/10 border border-red-500/20 text-red-500 hover:bg-red-600/20 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer font-mono"
                        >
                          End Broadcast Session
                        </button>
                      </div>

                    </div>

                    {/* Symmetrical Control Sidebar (Right 2 columns) */}
                    <div className="md:col-span-2 bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between relative overflow-hidden md:min-h-[530px]">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                          <Info className="w-4 h-4 text-emerald-400" />
                          <h5 className="font-semibold text-xs text-white uppercase tracking-wider font-mono">Live Translation Center</h5>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pb-1">
                          <div className="bg-[#050505] p-3 rounded-2xl border border-white/5 flex flex-col justify-between">
                            <span className="text-white/40 text-[9px] uppercase tracking-wider font-mono">Spoken Language</span>
                            <span className="text-emerald-400 font-bold text-xs mt-1 font-mono">
                              {speakingLanguage === "auto" 
                                ? (detectedLanguage || "Detecting...") 
                                : {
                                    en: "English",
                                    zh: "Mandarin",
                                    id: "Indonesian",
                                    km: "Khmer",
                                    ja: "Japanese",
                                    es: "Spanish"
                                  }[speakingLanguage] || speakingLanguage}
                            </span>
                          </div>

                          <div className="bg-[#050505] p-3 rounded-2xl border border-white/5 flex flex-col justify-between">
                            <span className="text-white/40 text-[9px] uppercase tracking-wider font-mono">Translating to</span>
                            <span className="text-white font-bold text-xs mt-1 font-mono">Multiple</span>
                          </div>
                        </div>

                        <div className="bg-[#050505] p-3 rounded-xl border border-white/5 flex items-center justify-between text-xs font-mono">
                          <span className="text-white/40 text-[9px] uppercase tracking-wider">WebSocket Ingress</span>
                          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                            <span>Active · 0.2s</span>
                          </div>
                        </div>

                        {/* Live original language speech transcript */}
                        <div className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col min-h-[160px] justify-between">
                          <div className="flex justify-between items-center mb-2.5">
                            <span className="text-white/45 text-[9px] uppercase tracking-wider font-mono">My Live Transcript (Original)</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          </div>
                          <div className="flex-1 overflow-y-auto max-h-[120px] text-xs space-y-2 opacity-90 pr-1">
                            {originalTranscriptHistory.map((text, idx) => (
                              <p key={idx} className="text-white/50 leading-relaxed font-sans border-b border-white/5 pb-1">
                                {text}
                              </p>
                            ))}
                            {originalTranscript ? (
                              <p className="text-emerald-400 font-semibold leading-relaxed font-sans">
                                {originalTranscript}
                              </p>
                            ) : (
                              <p className="text-white/30 text-[10px] font-mono italic">
                                Speak into your mic to see the live transcription here...
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Attendee Invite Section */}
                      <div className="space-y-4 border-t border-white/5 pt-4">
                        <div className="flex items-center gap-4">
                          <div className="bg-white p-2 rounded-2xl w-24 h-24 flex items-center justify-center shrink-0 shadow-lg select-none">
                            <img 
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getShareUrl())}`} 
                              alt="Join Room QR code" 
                              className="w-full h-full pointer-events-none"
                            />
                          </div>

                          <div className="flex-1 space-y-2 font-mono">
                            <button 
                              onClick={handleCopyLink} 
                              className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-black text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer font-sans"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              {isCopied ? "Copied!" : "Copy Invite"}
                            </button>
                            
                            <a 
                              href={getShareUrl()} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 font-sans"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Open Listener
                            </a>
                          </div>
                        </div>

                        <div className="flex items-center justify-between bg-black/45 px-3 py-2.5 rounded-xl border border-white/5 text-[10px] font-mono">
                          <span className="text-white/45 uppercase tracking-widest leading-none">Fallback Code</span>
                          <span className="text-white font-bold leading-none">{roomId}</span>
                        </div>
                      </div>

                    </div>

                  </div>
                ) : (
                  <div className="grid md:grid-cols-5 gap-8 mt-2 animate-fadeIn">
                    {/* Google Meet controller (3 columns) */}
                    <div className="md:col-span-3 bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between md:h-[500px]">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <Video className="w-5 h-5 text-emerald-400" />
                          <h5 className="font-semibold text-sm text-white">Google Meet Room Integration</h5>
                        </div>
                        <p className="text-xs text-white/50 leading-relaxed font-sans">
                          Create a Google Meet space to co-host or stream together. The link will be live-broadcasted to all your connected room attendees automatically.
                        </p>
                      </div>

                      <div className="space-y-4 pt-2 flex-1 flex flex-col justify-end">
                        {meetLink ? (
                          <div className="p-4 bg-emerald-500/5 border border-emerald-500/25 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="space-y-1 text-center sm:text-left">
                              <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider font-mono">Active Google Meet Space</p>
                              <a href={meetLink} target="_blank" rel="noopener noreferrer" className="text-xs text-white font-semibold underline font-mono break-all hover:text-emerald-300">
                                {meetLink}
                              </a>
                            </div>
                            <div className="flex gap-2 font-mono">
                              <a 
                                href={meetLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black text-[10px] font-bold uppercase tracking-wider rounded-full transition-colors flex items-center gap-1 shrink-0 font-sans"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Join Space
                              </a>
                              <button 
                                onClick={() => submitCustomMeetLink("")} 
                                className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-full transition-colors cursor-pointer"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            <div className="flex gap-2">
                              <input 
                                type="text"
                                placeholder="PASTE DIRECT GOOGLE MEET URL MANUAL"
                                value={customMeetLinkInput}
                                onChange={(e) => setCustomMeetLinkInput(e.target.value)}
                                className="flex-1 bg-[#050505] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500/50"
                              />
                              <button 
                                onClick={() => submitCustomMeetLink()}
                                className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-colors text-emerald-400 cursor-pointer font-mono"
                              >
                                Save Link
                              </button>
                            </div>

                            <div className="relative flex items-center justify-center py-1 h-[1px]">
                              <div className="absolute inset-x-0 h-[1px] bg-white/5" />
                              <span className="relative bg-[#0A0A0A] px-3 text-[10px] font-mono text-white/40 uppercase tracking-widest">Or Provision Space</span>
                            </div>

                            <button
                              onClick={generateMeetSpace}
                              disabled={isMeetGenerating}
                              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-bold uppercase tracking-widest rounded-xl transition-all disabled:opacity-50 cursor-pointer font-mono"
                            >
                              <Video className="w-4 h-4" />
                              {isMeetGenerating ? "Requesting OAuth Consent..." : "Connect Google & Create Meet Space"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Instant text-to-text Translation Panel (2 columns) */}
                    <div className="md:col-span-2 bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between md:h-[500px]">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-emerald-400" />
                          <h5 className="font-semibold text-sm text-white">Direct Message Translator</h5>
                        </div>
                        <p className="text-xs text-white/50 leading-relaxed font-sans">
                          Type messages to instantly translate into target language and broadcast over the feed.
                        </p>

                        <div className="space-y-2">
                          <textarea
                            placeholder="Type message text here..."
                            value={typedText}
                            onChange={(e) => setTypedText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                sendTextTranslation();
                              }
                            }}
                            className="w-full h-18 bg-[#050505] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500/50 resize-none font-sans"
                          />
                          <button
                            onClick={sendTextTranslation}
                            disabled={isTranslating || !typedText.trim()}
                            className="w-full py-2 bg-white/10 hover:bg-white/15 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all disabled:opacity-50 cursor-pointer font-mono"
                          >
                            {isTranslating ? "Translating..." : "Translate & Broadcast"}
                          </button>
                        </div>
                      </div>

                      {translatedTextResult && (
                        <div className="bg-emerald-500/5 border border-emerald-500/15 p-3 rounded-xl text-xs space-y-1">
                          <p className="text-[9px] uppercase font-mono text-emerald-400 tracking-widest font-semibold">Latest Spoken Prompt</p>
                          <p className="text-white font-medium leading-relaxed font-mono">{translatedTextResult}</p>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        )}

        {/* Confirmation Modal overlay for "End Broadcast" (Requirement 8) */}
        <AnimatePresence>
          {showEndConfirm && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0D0D0D] border border-red-500/30 rounded-3xl p-6 max-w-sm w-full space-y-6 text-center shadow-2xl relative"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-semibold text-lg text-white font-sans">End this broadcast?</h4>
                  <p className="text-white/80 text-xs leading-relaxed font-sans">
                    Listeners will immediately lose access to the live translation.
                  </p>
                </div>

                <div className="flex gap-3 pt-2 font-mono">
                  <button 
                    onClick={() => setShowEndConfirm(false)}
                    className="flex-1 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/90 text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setShowEndConfirm(false);
                      stopBroadcast();
                    }}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                  >
                    End Broadcast
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* 3. ATTENDEE LISTEN WORKSPACE */}
        {role === "attendee" && (
          <div className="max-w-3xl mx-auto w-full space-y-8">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-5">
              <div className="flex items-center gap-3">
                <button 
                  onClick={leaveRoom} 
                  className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 text-xs uppercase tracking-widest rounded-full transition-colors"
                >
                  &larr; Back
                </button>
                <h3 className="font-medium text-white text-lg">Attendee Listening Room</h3>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-white/50">
                <span>Room Code: {roomId.toUpperCase()}</span>
              </div>
            </div>

            {!isConnected ? (
              <div className="bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-8 space-y-6 max-w-xl mx-auto">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mx-auto">
                  <Languages className="w-8 h-8" />
                </div>
                
                <div className="space-y-2 text-center">
                  <h4 className="font-medium text-lg text-white">Setup Target Translation</h4>
                  <p className="text-white/50 text-sm">
                    Select your language. The translation engine will speak and display text translation.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="text-white/40 text-[10px] block mb-1 uppercase font-mono tracking-wider">Room Code</label>
                      <input 
                        type="text" 
                        value={roomId} 
                        onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/\s/g, ""))}
                        placeholder="ENTER ROOM CODE" 
                        className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-2.5 text-center text-white font-mono uppercase tracking-widest focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-white/40 text-[10px] block mb-1 uppercase font-mono tracking-wider">Language to listen in</label>
                      <div className="relative">
                        <select 
                          value={targetLang}
                          onChange={(e) => setTargetLang(e.target.value)}
                          className="w-full bg-[#050505] border border-white/10 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-emerald-500/50"
                        >
                          {LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                              {lang.flag} {lang.name} ({lang.native})
                            </option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-white/40">
                          &darr;
                        </div>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={startAttendeeSession}
                    className="w-full py-3.5 bg-white hover:bg-white/90 text-black text-[11px] font-bold uppercase tracking-widest rounded-full transition-all cursor-pointer shadow-lg"
                  >
                    Join Translation Feed
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-8">
                
                {/* Audio Connection Status and controls (1 column) */}
                <div className="bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between space-y-6 md:min-h-[625px]">
                  
                  <div className="space-y-4">
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold uppercase tracking-widest">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span>LIVE TRANSLATING</span>
                    </div>

                    <div className="p-4 bg-[#050505] rounded-2xl border border-white/5 space-y-3">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-white/70">Host Audio:</span>
                        <span className={`font-bold uppercase tracking-wide ${systemStatus.speakerConnected ? "text-emerald-400" : "text-yellow-500 animate-pulse"}`}>
                          {systemStatus.speakerConnected ? "Host Connected" : "Waiting for Host..."}
                        </span>
                      </div>
                      
                      {/* Interactive Language Switcher for Attendees without leaving (Requirement 22) */}
                      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
                        <span className="text-white/70 text-[10px] font-mono uppercase tracking-wider">Listening in:</span>
                        <div className="relative font-mono">
                          <select 
                            value={targetLang}
                            onChange={(e) => changeAttendeeLanguage(e.target.value)}
                            className="w-full bg-[#050505] border border-white/15 rounded-xl px-3 py-2 text-xs text-white appearance-none focus:outline-none focus:border-emerald-500/50 cursor-pointer"
                          >
                            {LANGUAGES.map((lang) => (
                              <option key={lang.code} value={lang.code}>
                                {lang.flag} {lang.name}
                              </option>
                            ))}
                          </select>
                          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-white/50 text-[10px]">
                            &darr;
                          </div>
                        </div>
                      </div>
                    </div>

                    {meetLink && (
                      <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl space-y-3 text-center">
                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest animate-pulse">Host Google Meet Is Live!</p>
                        <a 
                          href={meetLink} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black text-[10px] font-bold uppercase tracking-widest rounded-full transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 cursor-pointer font-sans"
                        >
                          <Video className="w-3.5 h-3.5" />
                          Join Call Space
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Speak in Discussion Toggle (Microphone Input) */}
                  <div className="border-t border-b border-white/5 py-4 space-y-3">
                    <div className="flex justify-between items-center text-[10px] font-mono text-white/55">
                      <span>MY MICROPHONE (SPEAK)</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${isBroadcasting ? "bg-red-500 animate-pulse" : "bg-white/10"}`} />
                    </div>
                    <button
                      onClick={toggleDiscussionMic}
                      className={`w-full py-3 px-4 rounded-full flex items-center justify-center gap-2 border text-[11px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
                        isBroadcasting
                          ? "bg-red-500 text-white border-transparent shadow-lg shadow-red-500/20"
                          : "bg-white/5 hover:bg-white/10 text-white/85 border-white/10"
                      }`}
                    >
                      {isBroadcasting ? (
                        <>
                          <Mic className="w-4 h-4 text-white animate-pulse" />
                          🎙️ MIC ACTIVE (SPEAKING)
                        </>
                      ) : (
                        <>
                          <MicOff className="w-4 h-4 text-white/50" />
                          🎙️ CLICK TO SPEAK in room
                        </>
                      )}
                    </button>
                    <p className="text-[9px] text-white/40 leading-normal font-mono italic">
                      Allows multiple people to talk concurrently in a live bilingual discussion.
                    </p>
                  </div>

                  {/* Volume playback controller */}
                  <div className="space-y-4 font-mono">
                    <button 
                      onClick={() => setIsAudioEnabled(!isAudioEnabled)}
                      className={`w-full py-3 px-4 rounded-full flex items-center justify-center gap-2 border text-[11px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
                        isAudioEnabled 
                          ? "bg-white text-black border-transparent shadow-lg shadow-white/5" 
                          : "bg-white/5 hover:bg-white/10 text-white/85 border-white/10"
                      }`}
                    >
                      {isAudioEnabled ? (
                        <>
                          <Volume2 className="w-4 h-4 text-emerald-400" />
                          🔊 Translated Audio Playing
                        </>
                      ) : (
                        <>
                          <VolumeX className="w-4 h-4 text-red-500" />
                          🔇 Audio Playback Muted
                        </>
                      )}
                    </button>

                    <button 
                      onClick={leaveRoom}
                      className="w-full h-10 px-6 rounded-full bg-red-600/10 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 cursor-pointer font-mono"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Leave Room
                    </button>
                  </div>

                </div>

                {/* Live Output Transcripts (2 columns) */}
                <div className="md:col-span-2 bg-[#0D0D0D]/50 border border-white/5 rounded-3xl p-6 flex flex-col justify-between md:min-h-[625px]">
                  
                  {/* Lyrics transcription segment with side by side columns */}
                  <div className="flex-1 overflow-y-auto pr-1 flex flex-col min-h-0">
                    {/* Chat Text Translation Fallback */}
                    {textTranslationHistory.length > 0 && (
                      <div className="space-y-2 mb-4 max-h-[120px] overflow-y-auto pr-2">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-[#10B981] font-bold">Chat Live Translation</p>
                        {textTranslationHistory.map((item, idx) => (
                          <div key={idx} className="bg-[#10B981]/5 px-3 py-2 rounded-xl border border-[#10B981]/15 space-y-1">
                            <div className="flex justify-between items-center text-[8px] font-mono text-[#10B981]">
                              <span>CHAT TRANSLATION</span>
                              <span>{item.timestamp}</span>
                            </div>
                            <p className="text-white text-xs font-semibold">{item.translated}</p>
                            <p className="text-white/40 text-[9px] font-mono italic">Original: "{item.original}"</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Symmetric side by side transcription panels */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 flex-1 min-h-0 min-w-0">
                      {/* Host Original Speech column */}
                      <div className="flex flex-col h-full min-h-0 justify-between space-y-3">
                        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-white/50 font-bold">Spoken Original ({speakingLanguage === "auto" ? detectedLanguage : LANGUAGES.find(l => l.code === speakingLanguage)?.name || speakingLanguage})</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        </div>
                        
                        <div className="flex-1 overflow-y-auto max-h-[180px] space-y-2 opacity-90 pr-1">
                          {originalTranscriptHistory.length > 0 ? (
                            originalTranscriptHistory.map((text, idx) => (
                              <div key={idx} className="bg-[#050505] px-3 py-1.5 rounded-lg border border-white/5 text-white/60 text-xs font-sans">
                                {text}
                              </div>
                            ))
                          ) : (
                            <p className="text-white/20 text-[10px] font-mono italic p-2">Original spoken segments will appear here...</p>
                          )}
                        </div>

                        {/* Highlighted live original text */}
                        <div className="p-4 bg-white/3 border border-white/5 rounded-2xl min-h-20 flex items-center">
                          {originalTranscript ? (
                            <p className="text-[14px] sm:text-[16px] font-semibold leading-snug text-white/90 tracking-tight">
                              {originalTranscript}
                            </p>
                          ) : (
                            <span className="text-white/40 text-[10px] flex items-center gap-1.5 font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                              Listening for original spoken voice...
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Your Hearing Translation column */}
                      <div className="flex flex-col h-full min-h-0 justify-between space-y-3">
                        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">Translation ({LANGUAGES.find(l => l.code === targetLang)?.name || targetLang})</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/20 animate-pulse" />
                        </div>

                        <div className="flex-1 overflow-y-auto max-h-[180px] space-y-2 opacity-90 pr-1">
                          {transcriptHistory.length > 0 ? (
                            transcriptHistory.map((text, idx) => (
                              <div key={idx} className="bg-[#050505] px-3 py-1.5 rounded-lg border border-white/5 text-[#A7F3D0]/80 text-xs font-sans">
                                {text}
                              </div>
                            ))
                          ) : (
                            <p className="text-white/20 text-[10px] font-mono italic p-2">Translated sentences will appear here...</p>
                          )}
                        </div>

                        {/* Highlighted live translation text */}
                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-2xl min-h-20 flex items-center">
                          {transcript ? (
                            <p className="text-[14px] sm:text-[16px] font-semibold leading-snug text-emerald-400 tracking-tight">
                              {transcript}
                            </p>
                          ) : (
                            <span className="text-emerald-400/60 text-[10px] flex items-center gap-1.5 font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/30 animate-pulse" />
                              Waiting for voice translation...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>

                  <div className="border-t border-white/5 pt-4 mt-4 flex items-center justify-between text-[10px] tracking-widest font-mono text-white/40">
                    <span>Double Panel Real-Time Display</span>
                    <span>Accuracy Indicator: HIGH</span>
                  </div>

                </div>

              </div>
            )}

          </div>
        )}

      </main>

      {/* Aesthetic Site Footer */}
      <footer className="border-t border-white/5 py-6 bg-[#0A0A0A] relative z-20 font-sans">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] uppercase tracking-widest text-white/40 font-mono">
          <div>
            <span>&copy; {new Date().getFullYear()} LIVEVOICE.</span>
          </div>
        </div>
      </footer>

      {/* Subtle Floating Watermark @bypeyovero Bottom Right */}
      <div className="fixed bottom-4 right-4 z-[99] pointer-events-auto select-none block">
        <a 
          href="https://github.com/bypeyovero" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[9px] font-mono uppercase tracking-widest text-white/30 hover:text-emerald-400 font-bold bg-[#0A0A0A]/85 backdrop-blur-sm border border-white/5 px-2.5 py-1.5 rounded-full shadow-lg transition-all duration-300 cursor-pointer"
        >
          @bypeyovero
        </a>
      </div>

    </div>
  );
}

