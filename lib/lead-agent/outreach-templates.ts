import { askGeminiText } from "./browser";
import type { Lead } from "@/lib/types";

/**
 * Generate a personalized cold outreach message for a lead.
 */
export async function generateOutreach(lead: Lead, language: string = "fr"): Promise<string> {
  const langInstruction = language === "fr"
    ? "Write in French (tu/vous formal)."
    : "Write in English.";

  const context = [
    lead.business_name && `Business: ${lead.business_name}`,
    lead.description && `Type: ${lead.description}`,
    lead.address && `Location: ${lead.address}`,
    lead.rating && `Rating: ${lead.rating}`,
    lead.review_count && `Reviews: ${lead.review_count}`,
    lead.has_website === false && "They have NO website",
    lead.has_website && lead.website_quality === "dead" && "Their website is BROKEN/dead",
    lead.has_website && lead.website_quality === "outdated" && "Their website is OUTDATED",
    lead.has_website && lead.website_quality === "poor" && "Their website is LOW QUALITY",
    lead.facebook_url && "They have a Facebook page",
    lead.instagram_url && "They have Instagram",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a cold outreach expert for a web agency. Generate a SHORT, personalized cold message for this business.

${context}

Rules:
- ${langInstruction}
- Keep it under 100 words
- Be direct, not salesy
- Reference something specific about their business (reviews, location, type)
- Clearly state the value prop: we build modern websites for businesses like theirs
- If they have no website: mention that their competitors have one and they're missing clients
- If they have a bad website: diplomatically mention their online presence could be improved
- End with a soft CTA (would you be open to a quick chat?)
- Sound human, not corporate
- No subject line needed, just the message body

Return ONLY the message text, no quotes, no explanation.`;

  return askGeminiText(prompt);
}
