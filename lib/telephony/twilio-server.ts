import twilio from "twilio";
import { getPublicAppUrl } from "./config";

export function getTwilioRestClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN manquants");
  }
  return twilio(sid, token);
}

export function generateClientAccessToken(identity: string): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const apiKey = process.env.TWILIO_API_KEY_SID!;
  const apiSecret = process.env.TWILIO_API_KEY_SECRET!;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID!;

  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 3600,
  });

  const grant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });
  token.addGrant(grant);

  return token.toJwt();
}

/**
 * Valide la signature Twilio.
 * Utilisez TWILIO_WEBHOOK_BASE_URL (ex. https://votredomaine.com) si l’URL
 * publique diffère de celle vue par Vercel.
 */
export function validateTwilioWebhook(
  request: Request,
  body: Record<string, string>
): boolean {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.SKIP_TWILIO_SIGNATURE_VALIDATION === "true"
  ) {
    return true;
  }
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;
  const urlObj = new URL(request.url);
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "") ||
    urlObj.origin;
  const fullUrl = `${base}${urlObj.pathname}${urlObj.search}`;
  return twilio.validateRequest(token, signature, fullUrl, body);
}

export function recordingCallbackUrl(): string {
  return `${getPublicAppUrl()}/api/telephony/webhooks/recording`;
}

export function statusCallbackUrl(): string {
  return `${getPublicAppUrl()}/api/telephony/webhooks/status`;
}
