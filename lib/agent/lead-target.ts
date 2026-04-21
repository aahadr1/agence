/**
 * Parse explicit lead/list counts from user prompts ("10 restaurants", "30 leads").
 */

export function parseLeadTargetFromUserPrompt(prompt: string): number | null {
  const p = prompt.trim();
  const m1 = p.match(
    /\b(\d{1,3})\s*(?:leads?|prospects?|professionnels?|lignes?|candidats?)\b/i,
  );
  if (m1) return Math.min(500, Math.max(1, parseInt(m1[1], 10)));
  const mRestaurant = p.match(
    /\b(\d{1,3})\s*(?:restaurants?|établissements?|commerces?|boutiques?)\b/i,
  );
  if (mRestaurant)
    return Math.min(500, Math.max(1, parseInt(mRestaurant[1], 10)));
  const m2 = p.match(
    /\b(?:liste|tableau)\s+(?:de|d['']|d')\s*(\d{1,3})\b/i,
  );
  if (m2) return Math.min(500, Math.max(1, parseInt(m2[1], 10)));
  return null;
}
