import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini Setup
  const apiKey = process.env.GEMINI_API_KEY || "";
  const genAI = new GoogleGenAI({ apiKey });

  // API Routes
  app.post("/api/chat", async (req, res) => {
    const { message, history, language, topic, difficultyLevel, includeAudio } = req.body;

    const chatModel = "gemini-3-flash-preview";
    const ttsModel = "gemini-2.5-flash-preview-tts";
    
    const difficultyInstruction = difficultyLevel === "Easy" 
      ? "Keep your response very short, maximum 2 sentences. Use simple vocabulary." 
      : difficultyLevel === "Medium" 
      ? "Keep your response moderate, maximum 5 sentences." 
      : "You can provide longer, more detailed responses with advanced vocabulary.";

    const systemInstruction = `
      You are Anna, a friendly foreigner friend who is helping the user practice ${language}.
      Current topic of conversation: ${topic}.
      User's proficiency level: ${difficultyLevel}.
      ${difficultyInstruction}
      
      Guidelines:
      1. Speak naturally in ${language}.
      2. Be encouraging and helpful.
      3. Keep the conversation engaging and relevant to the topic.
      4. If the user wants to change the topic, adapt to it.
      5. Your response MUST be a JSON object with two fields:
         - "text": Your message in ${language}.
         - "expression": One of "neutral", "happy", "thinking", "surprised", "sad" based on the context of your response.
    `;

    const contents = history.map((msg: any) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    }));

    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    try {
      // Step 1: Generate Text and Expression
      const chatResult = await genAI.models.generateContent({
        model: chatModel,
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              expression: { 
                type: Type.STRING,
                enum: ["neutral", "happy", "thinking", "surprised", "sad"]
              },
            },
            required: ["text", "expression"],
          },
        },
      });

      const responseText = chatResult.text;
      const parsed = JSON.parse(responseText);
      const text = parsed.text as string;
      const expression = parsed.expression || "neutral";
      
      let audioData: string | undefined;

      // Step 2: Generate Audio if requested
      if (includeAudio && text) {
        try {
          const ttsResult = await genAI.models.generateContent({
            model: ttsModel,
            contents: [{ parts: [{ text }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Kore' },
                },
              },
            },
          });

          const audioPart = ttsResult.candidates?.[0]?.content?.parts.find(p => p.inlineData);
          if (audioPart?.inlineData) {
            audioData = audioPart.inlineData.data;
          }
        } catch (ttsError: any) {
          console.error("Error generating audio:", ttsError);
          const errorMessage = ttsError?.message || "";
          if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
            return res.json({
              text: text + "\n\n(Note: My voice is temporarily resting due to high demand, but I can still chat with you!)",
              expression,
              audioData: undefined,
            });
          }
        }
      }

      res.json({
        text,
        expression,
        audioData,
      });
    } catch (error) {
      console.error("Error generating Anna's response:", error);
      res.status(500).json({
        text: "I'm sorry, I'm having a bit of trouble thinking right now. Could you say that again?",
        expression: "sad",
      });
    }
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
