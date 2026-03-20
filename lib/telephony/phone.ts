/** Normalise un numéro saisi (France) vers E.164 approximatif. */
export function normalizeToE164(input: string): string {
  let s = input.replace(/[\s.-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0")) s = `+33${s.slice(1)}`;
  if (!s.startsWith("+")) s = `+${s}`;
  return s;
}
