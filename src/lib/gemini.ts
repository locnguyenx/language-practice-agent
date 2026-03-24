import { Expression } from "../components/Avatar";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  expression?: Expression;
  audioData?: string; // Base64 audio data
}

export const generateAnnaResponse = async (
  message: string,
  history: ChatMessage[],
  language: string,
  topic: string,
  difficultyLevel: string,
  includeAudio: boolean = false,
  speechRate: number = 1.0
) => {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history,
        language,
        topic,
        difficultyLevel,
        includeAudio,
        speechRate,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch response from server");
    }

    const data = await response.json();
    return {
      text: data.text,
      expression: data.expression as Expression,
      audioData: data.audioData,
    };
  } catch (error) {
    console.error("Error generating Anna's response:", error);
    return {
      text: "I'm sorry, I'm having a bit of trouble thinking right now. Could you say that again?",
      expression: "sad" as Expression,
    };
  }
};
