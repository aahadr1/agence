import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "gemini-2.5-flash";
/** Twilio inline fetch limit vs Gemini / serverless — stay conservative */
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: MODEL });
}

/**
 * Twilio RecordingUrl is a base URL; append .mp3 for the audio file.
 */
export function twilioRecordingMediaUrl(recordingUrl: string): string {
  const u = recordingUrl.trim();
  if (u.endsWith(".mp3") || u.endsWith(".wav")) return u;
  return `${u}.mp3`;
}

async function fetchTwilioRecordingBuffer(
  recordingUrl: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;

  const url = twilioRecordingMediaUrl(recordingUrl);
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    console.error("[telephony/transcribe] fetch recording", res.status, url);
    return null;
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    console.warn("[telephony/transcribe] recording too large, skip", buf.length);
    return null;
  }
  return { buffer: buf, mimeType: mimeType || "audio/mpeg" };
}

export async function transcribeTwilioRecording(
  recordingUrl: string
): Promise<string | null> {
  const model = getGeminiModel();
  if (!model) return null;

  const fetched = await fetchTwilioRecordingBuffer(recordingUrl);
  if (!fetched) return null;

  const base64 = fetched.buffer.toString("base64");
  const prompt =
    "Transcris intégralement cet enregistrement d'appel téléphonique en français. " +
    "Si plusieurs personnes parlent, indique les tours de parole si c'est clair. " +
    "Réponds uniquement par la transcription, sans titre ni préambule.";

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: fetched.mimeType.includes("wav") ? "audio/wav" : "audio/mpeg",
        data: base64,
      },
    },
    { text: prompt },
  ]);

  const text = result.response.text()?.trim();
  return text || null;
}

export async function saveTranscriptionForCallSid(
  callSid: string,
  transcription: string | null
): Promise<void> {
  if (!transcription) return;
  try {
    const supabase = await createServiceClient();
    await supabase
      .from("telephony_calls")
      .update({
        transcription,
        updated_at: new Date().toISOString(),
      })
      .eq("call_sid", callSid);
  } catch (e) {
    console.error("[telephony/transcribe] save", e);
  }
}
