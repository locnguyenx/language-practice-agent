import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, Globe, MessageSquare, Settings, Sparkles, ChevronRight, RefreshCw, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Avatar, type Expression } from "./components/Avatar";
import { generateAnnaResponse, type ChatMessage } from "./lib/gemini";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const LANGUAGES = ["English", "Mandarin", "French", "German", "Japanese", "Vietnamese"];
const TOPICS = ["Daily Life", "Travel", "Hobbies", "Work", "Culture", "Food"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Advance"];

// Speech Recognition Type Definitions
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [isSetup, setIsSetup] = useState(true);
  const [language, setLanguage] = useState("English");
  const [topic, setTopic] = useState("Daily Life");
  const [difficulty, setDifficulty] = useState("Medium");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [expression, setExpression] = useState<Expression>("neutral");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [autoSendDelay, setAutoSendDelay] = useState(2);
  const [isAutoSendEnabled, setIsAutoSendEnabled] = useState(true);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const autoSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const latestTranscriptRef = useRef("");
  const messagesRef = useRef<ChatMessage[]>([]);
  const handleSendRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const isThinkingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        // Don't process results if Anna is already thinking/responding
        if (isThinkingRef.current) return;

        let fullTranscript = "";
        for (let i = 0; i < event.results.length; ++i) {
          fullTranscript += event.results[i][0].transcript;
        }

        if (fullTranscript.trim()) {
          console.log("Speech: Transcript received:", fullTranscript);
          setInput(fullTranscript);
          latestTranscriptRef.current = fullTranscript;

          if (isAutoSendEnabled) {
            if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
            autoSendTimerRef.current = setTimeout(() => {
              // Double check thinking state before auto-sending
              if (latestTranscriptRef.current.trim() && handleSendRef.current && !isThinkingRef.current) {
                console.log("Speech: Auto-sending transcript:", latestTranscriptRef.current);
                handleSendRef.current(latestTranscriptRef.current);
                recognitionRef.current?.stop();
              }
            }, autoSendDelay * 1000);
          }
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        // "no-speech" is a common error when the user is silent, we can just ignore it
        if (event.error === 'no-speech') {
          console.log("Speech: No speech detected, listening...");
          return;
        }
        
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      };
    }

    return () => {
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    };
  }, [autoSendDelay, isAutoSendEnabled, language]); // Re-bind when settings change

  const playAudio = async (base64Data: string) => {
    if (!base64Data) return;
    console.log("Anna: Attempting to play audio. Data length:", base64Data.length);
    try {
      const audioContext = getAudioContext();
      
      if (audioContext.state === 'suspended') {
        console.log("Anna: Resuming suspended AudioContext");
        await audioContext.resume();
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Try to decode as a standard audio file first (MP3, WAV, etc.)
      try {
        const bufferCopy = bytes.buffer.slice(0);
        const audioBuffer = await audioContext.decodeAudioData(bufferCopy);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = speechRate;
        source.connect(audioContext.destination);
        source.start(0);
        console.log("Anna: Audio played successfully as standard format");
      } catch (decodeError) {
        // If decoding fails, it's likely raw PCM 16-bit (Gemini TTS default)
        console.warn("Anna: Standard decoding failed, attempting raw PCM 16-bit playback", decodeError);
        
        // Ensure buffer length is even for Int16Array (2 bytes per sample)
        const buffer = bytes.buffer;
        const alignedLength = buffer.byteLength - (buffer.byteLength % 2);
        const pcmData = new Int16Array(buffer.slice(0, alignedLength));
        
        const floatData = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          floatData[i] = pcmData[i] / 32768.0; // Normalize to [-1.0, 1.0]
        }
        
        const audioBuffer = audioContext.createBuffer(1, floatData.length, 24000);
        audioBuffer.getChannelData(0).set(floatData);
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = speechRate;
        source.connect(audioContext.destination);
        source.start(0);
        console.log("Anna: Audio played successfully as raw PCM");
      }
    } catch (err) {
      console.error("Anna: Audio playback failed:", err);
    }
  };

  const testAudio = async () => {
    const response = await generateAnnaResponse("Hello! This is a test of my voice.", [], language, topic, difficulty, true, speechRate);
    if (response.audioData) {
      playAudio(response.audioData);
    } else {
      alert("Failed to generate test audio. Please check your connection.");
    }
  };

  const handleStart = async () => {
    // Initialize audio context immediately on user gesture to avoid browser blocks
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    setIsSetup(false);
    const welcomeText = `Hello! I'm Anna. I'm excited to practice ${language} with you today. Our topic is ${topic}. How are you doing?`;
    
    setIsThinking(true);
    const response = await generateAnnaResponse(welcomeText, [], language, topic, difficulty, isVoiceEnabled, speechRate);
    setIsThinking(false);

    const initialMessage: ChatMessage = {
      role: "model",
      text: welcomeText,
      expression: "happy",
      audioData: response.audioData
    };
    setMessages([initialMessage]);
    setExpression("happy");

    if (isVoiceEnabled && response.audioData) {
      playAudio(response.audioData);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const messageText = overrideInput || input;
    if (!messageText.trim() || isThinking) {
      console.log("handleSend: Blocked. Text empty or Anna is thinking.");
      return;
    }

    console.log("handleSend: Sending message:", messageText);
    const userMsg: ChatMessage = { role: "user", text: messageText };
    
    // Use functional update to avoid stale state issues
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    latestTranscriptRef.current = ""; // Clear the transcript ref immediately
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
    
    setIsThinking(true);
    setExpression("thinking");

    // Use the ref to get the absolute latest history for the API call
    const updatedHistory = [...messagesRef.current, userMsg];
    const response = await generateAnnaResponse(messageText, updatedHistory, language, topic, difficulty, isVoiceEnabled, speechRate);
    
    const annaMsg: ChatMessage = { 
      role: "model", 
      text: response.text, 
      expression: response.expression,
      audioData: response.audioData 
    };

    setMessages((prev) => [...prev, annaMsg]);
    setExpression(response.expression);
    setIsThinking(false);

    if (isVoiceEnabled && response.audioData) {
      playAudio(response.audioData);
    }
  };

  // Keep handleSendRef in sync
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const toggleListening = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      return;
    }

    try {
      // Request microphone permission explicitly to ensure it's granted
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (recognitionRef.current) {
        // Set language for recognition
        const langMap: Record<string, string> = {
          "English": "en-US",
          "Mandarin": "zh-CN",
          "French": "fr-FR",
          "German": "de-DE",
          "Japanese": "ja-JP",
          "Vietnamese": "vi-VN"
        };
        recognitionRef.current.lang = langMap[language] || "en-US";
        latestTranscriptRef.current = "";
        recognitionRef.current.start();
        setIsListening(true);
      } else {
        alert("Speech recognition is not supported in this browser. Please use Chrome or Edge.");
      }
    } catch (err) {
      console.error("Microphone access denied or error:", err);
      alert("Could not access microphone. Please ensure you have granted permission in your browser settings.");
      setIsListening(false);
    }
  };

  const handleTopicChange = (newTopic: string) => {
    setTopic(newTopic);
    const systemMsg: ChatMessage = {
      role: "model",
      text: `Sure! Let's change our topic to ${newTopic}. What would you like to talk about regarding ${newTopic}?`,
      expression: "happy",
    };
    setMessages((prev) => [...prev, systemMsg]);
    setExpression("happy");
  };

  if (isSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="atmosphere" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-8 w-full max-w-md space-y-8 relative z-10"
        >
          <div className="text-center space-y-2">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 4 }}
              className="inline-block"
            >
              <Sparkles className="w-12 h-12 text-orange-500 mx-auto" />
            </motion.div>
            <h1 className="text-4xl font-bold tracking-tight">Meet Anna</h1>
            <p className="text-white/60">Your expressive language companion</p>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-widest text-white/40 flex items-center gap-2">
                <Globe className="w-3 h-3" /> Target Language
              </label>
              <div className="grid grid-cols-3 gap-2">
                {LANGUAGES.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLanguage(l)}
                    className={cn(
                      "px-3 py-2 rounded-2xl text-sm transition-all border",
                      language === l 
                        ? "bg-pink-500 border-pink-400 text-white shadow-lg shadow-pink-500/20" 
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-widest text-white/40 flex items-center gap-2">
                <MessageSquare className="w-3 h-3" /> Starting Topic
              </label>
              <div className="grid grid-cols-3 gap-2">
                {TOPICS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTopic(t)}
                    className={cn(
                      "px-3 py-2 rounded-2xl text-sm transition-all border",
                      topic === t 
                        ? "bg-pink-500 border-pink-400 text-white shadow-lg shadow-pink-500/20" 
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] uppercase tracking-widest text-white/40 flex items-center gap-2">
                <Sparkles className="w-3 h-3" /> Anna's Talk Level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {DIFFICULTY_LEVELS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={cn(
                      "px-3 py-2 rounded-2xl text-sm transition-all border",
                      difficulty === d 
                        ? "bg-pink-500 border-pink-400 text-white shadow-lg shadow-pink-500/20" 
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-white/40 flex items-center gap-2">
                  <Volume2 className="w-3 h-3" /> Speech Speed
                </label>
                <span className="text-xs font-mono text-pink-400">{speechRate.toFixed(1)}x</span>
              </div>
              <div className="flex items-center gap-4 px-2">
                <input 
                  type="range" 
                  min="0.5" 
                  max="2.0" 
                  step="0.1" 
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="flex-1 accent-pink-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                />
                <button 
                  onClick={() => setSpeechRate(1.0)}
                  className="text-[10px] font-bold text-white/20 hover:text-white/60 transition-colors"
                >
                  RESET
                </button>
              </div>
            </div>

            <button
              onClick={handleStart}
              className="w-full py-4 bg-white text-black font-bold rounded-3xl hover:bg-pink-500 hover:text-white transition-all flex items-center justify-center gap-2 group"
            >
              Start Conversation
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row p-2 md:p-4 gap-2 md:gap-4 relative overflow-hidden">
      <div className="atmosphere" />

      {/* Sidebar / Avatar Section */}
      <div className="w-full md:w-80 flex flex-col gap-2 md:gap-4 shrink-0">
        <motion.div 
          layout
          className="glass p-4 md:p-6 flex flex-col items-center gap-4"
        >
          <div className="flex flex-row md:flex-col items-center justify-center w-full gap-4">
            <div className="w-16 md:w-auto">
              <Avatar expression={expression} />
            </div>
            <div className="text-left md:text-center flex-1 md:flex-none">
              <h2 className="text-xl md:text-2xl font-bold">Anna</h2>
              <p className="text-pink-500 text-xs md:text-sm font-medium flex flex-col md:flex-row items-start md:items-center md:justify-center gap-1">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-pink-500 rounded-full animate-pulse" />
                  Practicing {language}
                </span>
                <span className="hidden md:inline text-white/20">•</span>
                <span className="text-white/40 text-[10px] uppercase tracking-tighter">{difficulty} Level</span>
              </p>
            </div>
          </div>
          
          {/* Voice Toggle */}
          <div className="flex flex-wrap gap-2 justify-center w-full">
            <button 
              onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[10px] md:text-xs font-medium transition-all border",
                isVoiceEnabled 
                  ? "bg-pink-500/20 border-pink-500/30 text-pink-400" 
                  : "bg-white/5 border-white/10 text-white/40"
              )}
            >
              {isVoiceEnabled ? <Volume2 className="w-3 h-3 md:w-4 md:h-4" /> : <VolumeX className="w-3 h-3 md:w-4 md:h-4" />}
              <span className="hidden md:inline">Anna's Voice: {isVoiceEnabled ? "ON" : "OFF"}</span>
              <span className="md:hidden">{isVoiceEnabled ? "ON" : "OFF"}</span>
            </button>

            {/* Settings Toggle (Mobile Only) */}
            <button 
              onClick={() => setIsMobileSettingsOpen(!isMobileSettingsOpen)}
              className={cn(
                "md:hidden flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-medium transition-all border",
                isMobileSettingsOpen 
                  ? "bg-white/20 border-white/30 text-white" 
                  : "bg-white/5 border-white/10 text-white/40"
              )}
            >
              <Settings className="w-3 h-3" />
              <span>{isMobileSettingsOpen ? "CLOSE" : "SETTINGS"}</span>
            </button>
          </div>
        </motion.div>

          <div className={cn(
            "glass p-6 flex-1 flex flex-col gap-4",
            !isMobileSettingsOpen && "hidden md:flex"
          )}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Conversation Info</h3>
            <Settings className="w-4 h-4 text-white/20" />
          </div>
          
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Topic</p>
            <div className="text-lg font-light italic text-white/80">"{topic}"</div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Talk Level</p>
            <div className="flex gap-2">
              {DIFFICULTY_LEVELS.map(d => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] uppercase tracking-widest transition-all border",
                    difficulty === d 
                      ? "bg-pink-500/20 border-pink-500/40 text-pink-400" 
                      : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 py-2 border-y border-white/5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-white/30">Speech Speed</p>
              <span className="text-[10px] font-mono text-pink-400">{speechRate.toFixed(1)}x</span>
            </div>
            <div className="flex items-center gap-3">
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1" 
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                className="flex-1 accent-pink-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
              />
              <button 
                onClick={() => setSpeechRate(1.0)}
                className="text-[10px] font-bold text-white/20 hover:text-white/60 transition-colors"
              >
                RESET
              </button>
            </div>
          </div>

          <div className="space-y-2 mt-2">
            <p className="text-[10px] uppercase tracking-widest text-white/30">Change Topic</p>
            <div className="grid grid-cols-2 gap-2">
              {TOPICS.filter(t => t !== topic).map(t => (
                <button
                  key={t}
                  onClick={() => handleTopicChange(t)}
                  className="text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors border border-white/5"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 mt-6 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Voice Settings</h3>
              <Mic className="w-3 h-3 text-white/20" />
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/60 uppercase">Anna's Voice</span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={testAudio}
                    className="p-1 rounded bg-white/5 hover:bg-white/10 text-[8px] text-white/40 uppercase tracking-tighter"
                  >
                    Test
                  </button>
                  <button 
                    onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                    className={cn(
                      "w-8 h-4 rounded-full transition-colors relative",
                      isVoiceEnabled ? "bg-pink-500" : "bg-white/10"
                    )}
                  >
                    <motion.div 
                      animate={{ x: isVoiceEnabled ? 16 : 2 }}
                      className="absolute top-1 w-2 h-2 bg-white rounded-full"
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/60 uppercase">Auto-send</span>
                <button 
                  onClick={() => setIsAutoSendEnabled(!isAutoSendEnabled)}
                  className={cn(
                    "w-8 h-4 rounded-full transition-colors relative",
                    isAutoSendEnabled ? "bg-pink-500" : "bg-white/10"
                  )}
                >
                  <motion.div 
                    animate={{ x: isAutoSendEnabled ? 16 : 2 }}
                    className="absolute top-1 w-2 h-2 bg-white rounded-full"
                  />
                </button>
              </div>

              {isAutoSendEnabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-white/60 uppercase">Pause Delay</span>
                    <span className="text-[10px] text-pink-500 font-bold">{autoSendDelay}s</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="3" 
                    step="0.5"
                    value={autoSendDelay}
                    onChange={(e) => setAutoSendDelay(parseFloat(e.target.value))}
                    className="w-full accent-pink-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-auto pt-4 border-t border-white/10">
            <button 
              onClick={() => setIsSetup(true)}
              className="w-full py-2 text-xs text-white/40 hover:text-white flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Reset Session
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Section */}
      <div className="flex-1 flex flex-col glass overflow-hidden relative">
        {/* Chat Header (Mobile Only) */}
        <div className="md:hidden p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40">Topic</p>
            <p className="text-sm font-medium">{topic}</p>
          </div>
          <button onClick={() => setIsSetup(true)}>
            <Settings className="w-5 h-5 text-white/40" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 chat-scroll">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={cn(
                  "flex flex-col max-w-[85%]",
                  msg.role === "user" ? "ml-auto items-end" : "items-start"
                )}
              >
                <div className={cn(
                  "px-5 py-3.5 rounded-[2rem] text-sm leading-relaxed relative group",
                  msg.role === "user" 
                    ? "bg-pink-500 text-white rounded-tr-none shadow-lg shadow-pink-500/20" 
                    : "bg-white/10 text-white/90 rounded-tl-none border border-white/10"
                )}>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                  {msg.audioData && (
                    <button 
                      onClick={() => playAudio(msg.audioData!)}
                      className="absolute -right-10 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all shadow-lg border border-white/10"
                    >
                      <Volume2 className="w-4 h-4 text-pink-500" />
                    </button>
                  )}
                </div>
                <span className="text-[10px] mt-1 text-white/20 uppercase tracking-tighter">
                  {msg.role === "user" ? "You" : "Anna"}
                </span>
              </motion.div>
            ))}
            {isThinking && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 text-white/30 text-xs italic"
              >
                <div className="flex gap-1">
                  <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }} className="w-1.5 h-1.5 bg-white/40 rounded-full" />
                  <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-1.5 h-1.5 bg-white/40 rounded-full" />
                  <motion.div animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-1.5 h-1.5 bg-white/40 rounded-full" />
                </div>
                Anna is thinking...
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-white/5 border-t border-white/10">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="relative flex items-center gap-2"
          >
            <button
              type="button"
              onClick={toggleListening}
              className={cn(
                "p-4 rounded-3xl transition-all shadow-lg",
                isListening 
                  ? "bg-red-500 text-white animate-pulse" 
                  : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"
              )}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isListening ? "Listening..." : `Type in ${language}...`}
              className="flex-1 bg-white/5 border border-white/10 rounded-3xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-pink-500/50 transition-all placeholder:text-white/20"
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking}
              className="p-4 bg-white text-black rounded-3xl hover:bg-pink-500 hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black transition-all shadow-lg"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-[10px] text-center mt-3 text-white/20 uppercase tracking-widest">
            {isListening ? "Speak now..." : "Press Enter to send or use the mic"}
          </p>
        </div>
      </div>
    </div>
  );
}
