import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  randomDelay,
  diagnosePageAccess,
  type PageAccessDiagnostics,
} from "../browser";

export interface ContactPageResult {
  email: string | null;
  phone: string | null;
  credential_required?: boolean;
  page_access?: PageAccessDiagnostics;
  suggested_user_action_fr?: string | null;
  credential_hostname?: string | null;
}

/**
 * Common French contact page paths, ordered by how frequently they appear
 * on French SMB websites.
 */
const CONTACT_PATHS = [
  "/contact",
  "/nous-contacter",
  "/contactez-nous",
  "/contact.html",
  "/contact.php",
  "/coordonnees",
  "/coordonn%C3%A9es",
  "/joindre",
  "/contactus",
];

/**
 * Cleans a raw phone string extracted from a tel: href, turning
 * "+33612345678" → "06 12 34 56 78" and stripping non-digit noise.
 */
function cleanPhone(raw: string): string {
  // Strip everything except digits and leading +
  let p = raw.replace(/[^\d+]/g, "");
  // Convert international +33 prefix to local 0X notation
  if (p.startsWith("+33")) p = "0" + p.slice(3);
  // Format as pairs: 06 12 34 56 78
  if (/^0\d{9}$/.test(p)) {
    return p.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  }
  return p;
}

/**
 * Visit a business website's contact page(s) and extract email / phone.
 *
 * Strategy:
 * 1. Try each contact path in order until one returns a 2xx response.
 * 2. First pass: fast DOM extraction via querySelector for mailto:/tel: links
 *    and a regex scan of innerText for raw email addresses.
 * 3. Second pass (fallback): Gemini Vision screenshot extraction.
 * 4. Return as soon as both email and phone are found, or after all paths exhausted.
 */
export async function scrapContactPage(
  page: Page,
  websiteUrl: string,
  businessName: string,
  log: (msg: string) => void
): Promise<ContactPageResult | null> {
  const base = websiteUrl.replace(/\/+$/, "");

  let email: string | null = null;
  let phone: string | null = null;
  let accessBlock: PageAccessDiagnostics | null = null;

  for (const path of CONTACT_PATHS) {
    if (email && phone) break; // already have everything

    const url = `${base}${path}`;
    try {
      log(`[ContactPage] Trying ${url}`);
      const ok = await safeGoto(page, url, log, 10000);
      if (!ok) {
        const d = await diagnosePageAccess(page).catch(() => null);
        if (d?.captcha || d?.login_wall) accessBlock = d;
        continue;
      }

      const afterLoad = await diagnosePageAccess(page);
      if (afterLoad.captcha || afterLoad.login_wall) {
        accessBlock = afterLoad;
        continue;
      }

      // ── DOM extraction (fast, reliable) ──
      const domResult = await page.evaluate(() => {
        const found = { email: null as string | null, phone: null as string | null };

        // mailto: links
        document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]').forEach((a) => {
          if (!found.email) {
            const m = a.href.replace("mailto:", "").split("?")[0].trim();
            if (m.includes("@")) found.email = m;
          }
        });

        // tel: links
        document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]').forEach((a) => {
          if (!found.phone) {
            const raw = a.href.replace("tel:", "").trim();
            if (raw.replace(/[^\d]/g, "").length >= 9) found.phone = raw;
          }
        });

        // Text-based email scan (catches plain text like "contact@example.fr")
        if (!found.email) {
          const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
          const match = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          if (match) found.email = match[0];
        }

        return found;
      });

      if (domResult.email) email = domResult.email;
      if (domResult.phone) phone = cleanPhone(domResult.phone);

      if (email && phone) {
        log(`[ContactPage] ✓ DOM hit: email=${email} phone=${phone}`);
        return { email, phone };
      }

      // ── Gemini Vision fallback ──
      const vision = await screenshotAndAsk<ContactPageResult>(
        page,
        `You are looking at a contact page of the website for the French business "${businessName}".

Extract:
{
  "email": "the contact email address (look for @ symbol, mailto: links, form labels)" or null,
  "phone": "the phone number visible on this page (format: XX XX XX XX XX or 0X XX XX XX XX)" or null
}

Priority: pick the MAIN contact email (not noreply/newsletter). Pick the MAIN phone (not fax).
Only return data that is clearly visible. Return JSON only.`
      );

      if (!email && vision.email) email = vision.email;
      if (!phone && vision.phone) phone = vision.phone;

      if (email || phone) {
        log(`[ContactPage] ✓ Vision hit on ${path}: email=${email} phone=${phone}`);
      }

      await randomDelay(400, 900);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Re-throw browser-dead errors so the parent step() wrapper can handle them
      if (
        msg.includes("closed") ||
        msg.includes("Target closed") ||
        msg.includes("Protocol error")
      ) {
        throw e;
      }
      log(`[ContactPage] ✗ ${path}: ${msg.slice(0, 80)}`);
    }
  }

  if (email || phone) {
    log(`[ContactPage] ✓ Final: email=${email} phone=${phone}`);
    return { email, phone };
  }

  log(`[ContactPage] No contact info found across ${CONTACT_PATHS.length} paths`);
  if (accessBlock?.captcha || accessBlock?.login_wall) {
    return {
      email: null,
      phone: null,
      credential_required: accessBlock.login_wall,
      page_access: accessBlock,
      suggested_user_action_fr: accessBlock.suggested_action_fr,
      credential_hostname: accessBlock.credential_hostname,
    };
  }
  return null;
}
