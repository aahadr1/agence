/**
 * Twilio + téléphonie — variables d’environnement attendues.
 * Voir docs/TELEPHONY.md pour la configuration console Twilio.
 */
export function getPublicAppUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  if (url.startsWith("http")) return url.replace(/\/$/, "");
  return `https://${url}`.replace(/\/$/, "");
}

export function telephonyEnvReady(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER &&
      process.env.TWILIO_TWIML_APP_SID &&
      process.env.TWILIO_API_KEY_SID &&
      process.env.TWILIO_API_KEY_SECRET
  );
}
