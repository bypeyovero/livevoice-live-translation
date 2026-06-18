import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Shared active rooms data structure
interface SpeakerSession {
  ws: WebSocket;
  roomId: string;
  userId?: string;
}

interface AttendeeSession {
  ws: WebSocket;
  roomId: string;
  lang: string;
  geminiSession?: any; // Connection to Gemini Live API
  isConnecting?: boolean;
  reconnect?: () => Promise<void>;
  userId?: string;
  inputTranscriptBuffer?: string;
  outputTranscriptBuffer?: string;
  audioChunksBuffer?: string[];
}

const rooms = new Map<string, {
  speakers: Set<SpeakerSession>;
  attendees: Set<AttendeeSession>;
  meetLink?: string;
  speakingLanguageCode?: string;
}>();

// Helper to get or create room
function getOrCreateRoom(roomId: string) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { speakers: new Set(), attendees: new Set(), speakingLanguageCode: "auto" });
  }
  return rooms.get(roomId)!;
}

// Broadcasting system state updates
function broadcastSystemStatus(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const speakerConnected = room.speakers.size > 0;
  const attendeeCount = room.attendees.size;
  const meetLink = room.meetLink || null;
  const speakingLanguageCode = room.speakingLanguageCode || "auto";

  const payload = JSON.stringify({
    type: "system",
    speakerConnected,
    attendeeCount,
    meetLink,
    speakingLanguageCode,
  });

  for (const speaker of room.speakers) {
    if (speaker.ws.readyState === WebSocket.OPEN) {
      speaker.ws.send(payload);
    }
  }

  for (const attendee of room.attendees) {
    if (attendee.ws.readyState === WebSocket.OPEN) {
      attendee.ws.send(payload);
    }
  }
}

// Lazy initialization of Gemini client to prevent crash on startup if key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error("GEMINI_API_KEY is not configured on the server. Please add your key in the Secrets/Env settings.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

function getSafeErrorMessage(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.error && typeof err.error.message === "string") return err.error.message;
  try {
    const str = String(err);
    if (str && str !== "[object Object]") return str;
  } catch (e) {}
  try {
    return JSON.stringify(err);
  } catch (e) {
    return "Non-serializable error object";
  }
}

// Main server start up
async function startServer() {
  app.use(express.json());

  // API health route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
  });

  // Google Meet Space creation route
  app.post("/api/create-meet", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: "Missing Authorization header" });
      }

      console.log("Calling Google Meet API to create room");
      const meetResponse = await fetch("https://meet.googleapis.com/v2/spaces", {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      if (!meetResponse.ok) {
        const errText = await meetResponse.text();
        console.error("Google Meet API returned error:", errText);
        return res.status(meetResponse.status).json({ 
          error: `Google Meet API error: ${meetResponse.statusText}`, 
          details: errText 
        });
      }

      const data = await meetResponse.json();
      res.json(data);
    } catch (err: any) {
      console.error("Unhandled error creating Google Meet room:", err);
      res.status(500).json({ error: "Server failed to initiate Google Meet room" });
    }
  });

  const hServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade to WebSockets under /api/ws
  hServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/api/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws, request) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const role = url.searchParams.get("role") || "attendee";
    const roomId = url.searchParams.get("roomId") || "default";
    const lang = url.searchParams.get("lang") || "es"; // target translation language
    const speakingLang = url.searchParams.get("speakingLang") || "auto";

    const userId = url.searchParams.get("userId") || undefined;

    console.log(`New WS connection: role=${role}, roomId=${roomId}, lang=${lang}, speakingLang=${speakingLang}, userId=${userId}`);

    const room = getOrCreateRoom(roomId);

    if (role === "speaker") {
      if (speakingLang) {
        room.speakingLanguageCode = speakingLang;
      }

      const speakerSession: SpeakerSession = { ws, roomId, userId };
      room.speakers.add(speakerSession);
      broadcastSystemStatus(roomId);

      ws.on("message", async (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === "audio" && parsed.data) {
            // Forward raw PCM audio data of the speaker to all other attendee Gemini Live sessions
            const audioData = parsed.data; // base64
            const senderUserId = parsed.userId || userId;
            for (const attendee of room.attendees) {
              // Skip self to prevent hearing our translated own voice
              if (attendee.userId && attendee.userId === senderUserId) {
                continue;
              }
              if (attendee.geminiSession) {
                try {
                  attendee.geminiSession.sendRealtimeInput({
                    audio: {
                      data: audioData,
                      mimeType: "audio/pcm;rate=16000",
                    },
                  });
                } catch (err) {
                  // Ignore single send failure to keep connection resilient
                }
              }
            }
          } else if (parsed.type === "text-translate") {
            const { text, targetLang } = parsed;
            const senderUserId = parsed.userId || userId;
            const ai = getGeminiClient();
            try {
              const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Translate the following text into ${targetLang}. Return ONLY the direct translation, with no explanation, quotes or commentary.\n\nText: ${text}`,
              });
              const translatedText = response.text?.trim() || "";
              
              const payload = JSON.stringify({
                type: "text-translation-result",
                originalText: text,
                translatedText,
                targetLang,
                sender: "speaker",
                senderId: senderUserId,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              });

              // Broadcast to all speakers and attendees
              for (const speaker of room.speakers) {
                if (speaker.ws.readyState === WebSocket.OPEN) {
                  speaker.ws.send(payload);
                }
              }
              for (const attendee of room.attendees) {
                if (attendee.ws.readyState === WebSocket.OPEN) {
                  attendee.ws.send(payload);
                }
              }
            } catch (err: any) {
              console.error("Text translation generation failed:", err);
              ws.send(JSON.stringify({ type: "error", message: `Text translation failed: ${getSafeErrorMessage(err)}` }));
            }
          } else if (parsed.type === "set-meet-link") {
            room.meetLink = parsed.link || undefined;
            broadcastSystemStatus(roomId);
          } else if (parsed.type === "change-speaking-language") {
            const newSpeakingLang = parsed.languageCode || "auto";
            console.log(`Speaker in room ${roomId} changed speaking language to: ${newSpeakingLang}`);
            room.speakingLanguageCode = newSpeakingLang;
            
            broadcastSystemStatus(roomId);

            // Re-establish Gemini Live translator instances for all listeners
            for (const attendee of room.attendees) {
              if (attendee.reconnect) {
                attendee.reconnect().catch((reconnectErr) => {
                  console.error("Failed to dynamically reconnect attendee session during language switch:", reconnectErr);
                });
              }
            }
          }
        } catch (e) {
          console.error("Error processing speaker message:", e);
        }
      });

      ws.on("error", (error) => {
        console.error(`Speaker WebSocket error in room ${roomId}:`, error);
      });

      ws.on("close", () => {
        room.speakers.delete(speakerSession);
        broadcastSystemStatus(roomId);
        console.log(`Speaker disconnected from room: ${roomId}`);
      });

    } else {
      // Attendee session
      const attendeeSession: AttendeeSession = { ws, roomId, lang, userId, isConnecting: true };
      room.attendees.add(attendeeSession);
      broadcastSystemStatus(roomId);

      // Offline language detector based on character sets & common stop words
      const detectLanguage = (text: string): string => {
        const clean = text.toLowerCase().trim();
        if (!clean) return "English";

        // Character set checks
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "Japanese";
        if (/[\uac00-\ud7af]/.test(text)) return "Korean";
        if (/[\u0e00-\u0e7f]/.test(text)) return "Thai";
        if (/[\u1780-\u17ff]/.test(text)) return "Khmer";
        if (/[\u4e00-\u9fa5]/.test(text)) return "Mandarin Chinese";

        // Stopwords / word indicators list
        const indonesianStopwords = ["dan", "yang", "untuk", "dengan", "saya", "ini", "itu", "di", "ada", "bisa", "tidak", "terima", "kasih", "apa", "kabar", "kami", "mereka", "anda", "kamu", "bukan", "adalah", "ya", "ia", "kita", "dia", "pun", "akan", "sudah", "dari", "ke"];
        const spanishStopwords = ["el", "la", "los", "las", "y", "en", "que", "es", "para", "con", "hola", "gracias", "nosotros", "como", "este", "esta", "pero", "del", "al", "por"];
        const frenchStopwords = ["le", "la", "les", "et", "en", "que", "est", "un", "une", "pour", "avec", "nous", "vous", "dans", "sur", "mais", "pas", "plus", "bonjour", "merci"];
        const germanStopwords = ["der", "die", "das", "und", "ist", "in", "zu", "den", "von", "mit", "nicht", "auch", "auf", "ein", "eine", "wir", "sie", "es", "hallo", "danke"];
        const vietnameseIndicators = ["tiếng", "việt", "không", "có", "người", "được", "cho", "với", "hông", "anh", "em", "ông", "bà", "tôi", "chúng", "đẹp", "ăn", "uống"];
        const isVietnameseAccents = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text);

        const words = clean.split(/\s+/);
        let idCount = 0;
        let esCount = 0;
        let frCount = 0;
        let deCount = 0;
        let viCount = isVietnameseAccents ? 3 : 0;

        for (const w of words) {
          if (indonesianStopwords.includes(w)) idCount++;
          if (spanishStopwords.includes(w)) esCount++;
          if (frenchStopwords.includes(w)) frCount++;
          if (germanStopwords.includes(w)) deCount++;
          if (vietnameseIndicators.includes(w)) viCount += 2;
        }

        const max = Math.max(idCount, esCount, frCount, deCount, viCount);
        if (max > 0) {
          if (max === idCount) return "Indonesian";
          if (max === esCount) return "Spanish";
          if (max === frCount) return "French";
          if (max === deCount) return "German";
          if (max === viCount) return "Vietnamese";
        }

        return "English";
      };

      // Helper function to build client connection to Gemini
      const setupSession = async (targetLangCode: string) => {
        const ai = getGeminiClient();
        const languageMap: Record<string, string> = {
          es: "Spanish",
          ja: "Japanese",
          km: "Khmer",
          id: "Indonesian",
          zh: "Mandarin Chinese",
          fr: "French",
          de: "German",
          ko: "Korean",
          vi: "Vietnamese",
          th: "Thai",
          en: "English"
        };
        const langName = languageMap[targetLangCode] || "English";
        const inputLangCode = room.speakingLanguageCode && room.speakingLanguageCode !== "auto" ? room.speakingLanguageCode : undefined;
        const inputLangName = inputLangCode ? (languageMap[inputLangCode] || inputLangCode) : "the speaker's language";

        const sysInstruction = `You are a professional real-time speech translator. Translate all spoken audio strictly from ${inputLangName} directly into ${langName}. The target language is ${langName}. Your output must be spoken audio and transcripts in ${langName} only. Do not speak Spanish if the target language is ${langName}. Do not default to Spanish.`;

        console.log(`Setting up Gemini Session in Room ${roomId} for Input Language: ${inputLangName} and Target Language: ${langName} (${targetLangCode})`);

        return await ai.live.connect({
          model: "gemini-3.5-live-translate-preview",
          config: {
            responseModalities: ["AUDIO" as any],
            translationConfig: {
              targetLanguageCode: targetLangCode,
              echoTargetLanguage: false,
              ...(inputLangCode ? { sourceLanguageCode: inputLangCode } : {}),
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: sysInstruction,
          },
          callbacks: {
            onmessage: (message: any) => {
              // Extract translated audio
              const audioBase64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioBase64) {
                attendeeSession.audioChunksBuffer = attendeeSession.audioChunksBuffer || [];
                attendeeSession.audioChunksBuffer.push(audioBase64);
              }

              // Extract translated transcription text (model output)
              // Handle multiple potential pathways for robust output transcription
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.text) {
                    attendeeSession.outputTranscriptBuffer = (attendeeSession.outputTranscriptBuffer || "") + part.text;
                  }
                }
              }

              const outputTranscription = message.serverContent?.outputTranscription;
              if (outputTranscription?.text) {
                attendeeSession.outputTranscriptBuffer = (attendeeSession.outputTranscriptBuffer || "") + outputTranscription.text;
              }

              // Extract input speaker transcription for Realtime Language Detection
              const handleSpeakerInputText = (text: string) => {
                const originalText = text.trim();
                if (originalText) {
                  const detectedLang = detectLanguage(originalText);
                  const langPayload = JSON.stringify({
                    type: "speaker-language",
                    language: detectedLang,
                    originalText: originalText
                  });
                  ws.send(langPayload); // Send to attendee

                  // Also send to all host speakers so they see it live
                  for (const speaker of room.speakers) {
                    if (speaker.ws.readyState === WebSocket.OPEN) {
                      speaker.ws.send(langPayload);
                    }
                  }
                }
              };

              const inputTranscription = message.serverContent?.inputTranscription;
              if (inputTranscription?.text) {
                attendeeSession.inputTranscriptBuffer = (attendeeSession.inputTranscriptBuffer || "") + " " + inputTranscription.text;
              }

              const flushBuffers = () => {
                // 1. Flush original speaker input
                const currentInputText = (attendeeSession.inputTranscriptBuffer || "").trim().replace(/\s+/g, " ");
                if (currentInputText) {
                  handleSpeakerInputText(currentInputText);
                }
                attendeeSession.inputTranscriptBuffer = "";

                // 2. Flush translated output text
                const currentOutputText = (attendeeSession.outputTranscriptBuffer || "").trim().replace(/\s+/g, " ");
                if (currentOutputText) {
                  ws.send(JSON.stringify({ type: "transcription", text: currentOutputText }));
                }
                attendeeSession.outputTranscriptBuffer = "";

                // 3. Flush translated audio
                if (attendeeSession.audioChunksBuffer && attendeeSession.audioChunksBuffer.length > 0) {
                  for (const audio of attendeeSession.audioChunksBuffer) {
                    ws.send(JSON.stringify({ type: "audio", data: audio }));
                  }
                  attendeeSession.audioChunksBuffer = [];
                }
              };

              // If turnComplete is signaled, flush everything!
              if (message.serverContent?.turnComplete) {
                flushBuffers();
              } else {
                // Otherwise check if a sentence has ended with punctuation (English, Spanish, Asian punctuation)
                const currentInputText = (attendeeSession.inputTranscriptBuffer || "").trim().replace(/\s+/g, " ");
                if (currentInputText && currentInputText.match(/[.!?。？！]$/)) {
                  handleSpeakerInputText(currentInputText);
                  attendeeSession.inputTranscriptBuffer = "";
                }

                const currentOutputText = (attendeeSession.outputTranscriptBuffer || "").trim().replace(/\s+/g, " ");
                if (currentOutputText && currentOutputText.match(/[.!?。？！]$/)) {
                  ws.send(JSON.stringify({ type: "transcription", text: currentOutputText }));
                  attendeeSession.outputTranscriptBuffer = "";

                  if (attendeeSession.audioChunksBuffer && attendeeSession.audioChunksBuffer.length > 0) {
                    for (const audio of attendeeSession.audioChunksBuffer) {
                      ws.send(JSON.stringify({ type: "audio", data: audio }));
                    }
                    attendeeSession.audioChunksBuffer = [];
                  }
                }
              }

              if (message.serverContent?.interrupted) {
                attendeeSession.audioChunksBuffer = [];
                attendeeSession.outputTranscriptBuffer = "";
                attendeeSession.inputTranscriptBuffer = "";
                ws.send(JSON.stringify({ type: "interrupted" }));
              }
            },
            onclose: (event: any) => {
              console.log(`Gemini live session closed for language: ${targetLangCode}`, event);
              ws.send(JSON.stringify({ type: "status", message: "Translation session closed." }));
            },
            onerror: (err: any) => {
              console.error(`Gemini live session error:`, err);
              ws.send(JSON.stringify({ type: "error", message: `Live translation connection issue: ${getSafeErrorMessage(err)}` }));
            }
          }
        });
      };

      attendeeSession.reconnect = async () => {
        if (attendeeSession.geminiSession) {
          try {
            await attendeeSession.geminiSession.close();
          } catch (e) {
            // ignore
          }
          attendeeSession.geminiSession = null;
        }
        try {
          const session = await setupSession(attendeeSession.lang);
          attendeeSession.geminiSession = session;
          ws.send(JSON.stringify({ type: "status", message: `Connected to Gemini Live. Target language set to: ${attendeeSession.lang}` }));
        } catch (err: any) {
          console.error("Setup attendee session failure (reconnect):", err);
          ws.send(JSON.stringify({ type: "error", message: `Failed to initialize Live Translation service: ${getSafeErrorMessage(err)}` }));
        }
      };

      // Initial Gemini connection creation
      attendeeSession.reconnect()
        .then(() => {
          attendeeSession.isConnecting = false;
        })
        .catch(() => {
          attendeeSession.isConnecting = false;
        });

      ws.on("message", async (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === "text-translate") {
            const { text, targetLang: requestedTargetLang } = parsed;
            const ai = getGeminiClient();
            try {
              const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Translate the following text into ${requestedTargetLang}. Return ONLY the direct translation, with no explanation, quotes or commentary.\n\nText: ${text}`,
              });
              const translatedText = response.text?.trim() || "";
              
              ws.send(JSON.stringify({
                type: "text-translation-result",
                originalText: text,
                translatedText,
                targetLang: requestedTargetLang,
                sender: "attendee",
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              }));
            } catch (err: any) {
              console.error("Text translation error:", err);
              ws.send(JSON.stringify({ type: "error", message: `Text translation failed: ${getSafeErrorMessage(err)}` }));
            }
          } else if (parsed.type === "change-language") {
            const newLang = parsed.lang;
            console.log(`Attendee requested language change to: ${newLang}`);
            attendeeSession.lang = newLang;
            
            ws.send(JSON.stringify({ type: "status", message: `Switching live voice translation to: ${newLang}...` }));
            
            if (attendeeSession.geminiSession) {
              try {
                await attendeeSession.geminiSession.close();
              } catch (e) {
                // Ignore close error
              }
            }

            try {
              const session = await setupSession(newLang);
              attendeeSession.geminiSession = session;
              ws.send(JSON.stringify({ type: "status", message: `Connected to Gemini Live. Target language set to: ${newLang}` }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: "error", message: `Failed to switch live translation: ${getSafeErrorMessage(err)}` }));
            }
          }
        } catch (e) {
          console.error("Error handling attendee WS message:", e);
        }
      });

      ws.on("error", (error) => {
        console.error(`Attendee WebSocket error in room ${roomId}:`, error);
      });

      ws.on("close", () => {
        room.attendees.delete(attendeeSession);
        if (attendeeSession.geminiSession) {
          try {
            attendeeSession.geminiSession.close();
          } catch (e) {
            // Ignore close errors
          }
        }
        broadcastSystemStatus(roomId);
        console.log(`Attendee disconnected from room: ${roomId}`);
      });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  hServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server startup crash:", err);
});
