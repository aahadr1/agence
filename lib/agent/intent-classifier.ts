function normalizeIntentText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

export function isSmallTalkOnly(input: string): boolean {
  const t = normalizeIntentText(input).replace(/[.!?…\s]+$/g, "");
  if (!t) return false;
  if (t.length > 80) return false;
  return /^(?:hey|hi|hello|bonjour|bonsoir|salut|slt|bjr|coucou|yo|test|ca va|ça va|comment ca va|comment ça va)$/.test(
    t,
  );
}

export function smallTalkAssistantReply(input: string): string {
  const french = /[àâäçéèêëîïôöùûüÿœ]|^(?:bonjour|bonsoir|salut|slt|bjr|coucou|ca va|ça va)/i.test(
    input.trim(),
  );
  return french
    ? "Bonjour. Donnez-moi une mission précise et je m’en occupe."
    : "Hi. Send me a concrete task and I’ll handle it.";
}

export function hasLeadGenerationIntent(input: string): boolean {
  const t = normalizeIntentText(input);
  if (!t || isSmallTalkOnly(t)) return false;
  const asksForListOrSearch =
    /\b(?:trouve|trouver|cherche|chercher|liste|lister|donne|donner|identifie|identifier|prospect|prospects|leads?|lead\s*gen|prospection|recherche|selection|sélection)\b/.test(
      t,
    );
  const businessSignals =
    /\b(?:restaurant|restaurants|entreprise|entreprises|business|commerce|commerces|boutique|boutiques|agence|agences|cabinet|cabinets|avocat|avocats|dentiste|dentistes|garage|garages|plombier|plombiers|dirigeant|dirigeants|gerant|gerants|gérant|gérants|contact|contacts|siren|siret|pappers|societe\.?com|google maps|gmb)\b/.test(
      t,
    );
  const countSignal = /\b\d{1,3}\b/.test(t);
  const businessWithLocation =
    businessSignals &&
    /\b(?:a|à|sur|in|near|autour de|dans|en)\s+[a-z][a-z0-9 -]{2,}\b/.test(t);
  return (
    (asksForListOrSearch && businessSignals) ||
    (countSignal && businessSignals) ||
    businessWithLocation
  );
}
