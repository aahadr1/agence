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
  if (process.env.SKIP_TWILIO_SIGNATURE_VALIDATION === "true") {
    return true;
  }
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    console.error("[twilio-webhook] TWILIO_AUTH_TOKEN missing");
    return false;
  }
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) {
    console.error("[twilio-webhook] x-twilio-signature header missing");
    return false;
  }
  const urlObj = new URL(request.url);
  const pathname = urlObj.pathname;
  const search = urlObj.search;
  const canonicalBase =
    process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "") ||
    getPublicAppUrl();
  const candidateUrls = [
    `${canonicalBase}${pathname}${search}`,
    `${urlObj.origin}${pathname}${search}`,
  ];
  const uniqueUrls = [...new Set(candidateUrls)];
  const valid = uniqueUrls.some((fullUrl) =>
    twilio.validateRequest(token, signature, fullUrl, body)
  );
  if (!valid) {
    console.error("[twilio-webhook] signature mismatch", {
      tried: uniqueUrls,
      origin: urlObj.origin,
    });
  }
  return valid;
}

/**
 * Caller ID affiché au destinataire.
 * TWILIO_CALLER_ID = ton 06/07 vérifié (Verified Caller ID).
 * Fallback sur TWILIO_PHONE_NUMBER (numéro Twilio acheté).
 */
export function getCallerId(): string {
  return process.env.TWILIO_CALLER_ID || process.env.TWILIO_PHONE_NUMBER || "";
}

/**
 * Numéro Twilio acheté — requis comme `from` dans les appels API.
 */
export function getTwilioNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER || "";
}

export function recordingCallbackUrl(): string {
  return `${getPublicAppUrl()}/api/telephony/webhooks/recording`;
}

export function statusCallbackUrl(): string {
  return `${getPublicAppUrl()}/api/telephony/webhooks/status`;
}
