import type { Page } from "playwright-core";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

export interface MapsLead {
  business_name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rating: string | null;
  review_count: string | null;
  review_highlights: string[];
  has_website: boolean;
  website_url: string | null;
  google_maps_url: string | null;
}

interface GeminiBusinessDetails {
  business_name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rating: string | null;
  review_count: string | null;
  review_highlights: string[];
  has_website: boolean;
  website_url: string | null;
}

async function waitForMapsResults(page: Page) {
  await page
    .waitForSelector('div[role="feed"], div[role="main"]', { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
}

/**
 * Scrape Google Maps for a single query. Returns all businesses found.
 */
export async function scrapeGoogleMaps(
  page: Page,
  query: string,
  seenNames: Set<string>,
  log: (msg: string) => void,
  maxScrolls: number = 4,
  maxLeads: number = 25,
  deadline: number = Infinity
): Promise<MapsLead[]> {
  const leads: MapsLead[] = [];

  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  log(`[Maps] Searching: "${query}"`);

  await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  // Handle consent if redirected
  if (page.url().includes("consent.google.com")) {
    log("[Maps] Handling consent page...");
    try {
      await page.locator('button:has-text("Tout accepter")').first().click();
      await page.waitForTimeout(3000);
    } catch {
      await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
    }
  }

  await waitForMapsResults(page);

  for (let scroll = 0; scroll < maxScrolls && leads.length < maxLeads; scroll++) {
    if (Date.now() >= deadline) { log("[Maps] ⏱ Time budget reached"); break; }
    const placeLinks = await page.locator('a[href*="/maps/place/"]').all();
    if (placeLinks.length === 0) break;

    log(`[Maps] Page ${scroll + 1}: ${placeLinks.length} links`);

    for (let i = 0; i < placeLinks.length && leads.length < maxLeads; i++) {
      if (Date.now() >= deadline) { log("[Maps] ⏱ Time budget reached"); break; }
      const link = placeLinks[i];
      let ariaLabel = "";
      try {
        ariaLabel = (await link.getAttribute("aria-label")) || "";
      } catch {
        continue;
      }

      if (!ariaLabel || seenNames.has(ariaLabel.toLowerCase())) continue;

      try {
        await link.click();
      } catch {
        continue;
      }

      await page.waitForTimeout(2500);
      const currentUrl = page.url();
      const detailScreenshot = await screenshotToBase64(page);

      try {
        const details = await askGemini<GeminiBusinessDetails>(
          `You are looking at a Google Maps business detail page.

Extract ALL available information:
{
  "business_name": "exact name",
  "description": "type/category",
  "address": "full street address — look for map pin icon with text",
  "phone": "phone number — look for phone icon with number, format: +33 X XX XX XX XX",
  "email": null,
  "rating": "X.X" or null,
  "review_count": "number" or null,
  "review_highlights": ["up to 3 review snippets"],
  "has_website": look at the ACTION BUTTONS row (Directions, Website, Save). Is there a "Website"/"Site web" button? true/false,
  "website_url": "URL if visible" or null
}

Return JSON only.`,
          detailScreenshot
        );

        seenNames.add(ariaLabel.toLowerCase());
        if (details.business_name) {
          seenNames.add(details.business_name.toLowerCase());
        }

        leads.push({
          business_name: details.business_name || ariaLabel,
          description: details.description,
          address: details.address,
          phone: details.phone,
          email: details.email,
          rating: details.rating,
          review_count: details.review_count,
          review_highlights: details.review_highlights || [],
          has_website: details.has_website ?? false,
          website_url: normalizeUrl(details.website_url),
          google_maps_url: currentUrl,
        });

        const status = details.has_website ? "has website" : "NO WEBSITE";
        log(`[Maps] ✓ ${details.business_name || ariaLabel} — ${status}`);
      } catch (e) {
        log(`[Maps] ✗ Failed to extract "${ariaLabel}": ${e}`);
      }

      // Go back
      try {
        const backBtn = page
          .locator('button[aria-label="Back"], button[jsaction*="back"]')
          .first();
        if (await backBtn.isVisible({ timeout: 2000 })) {
          await backBtn.click();
        } else {
          await page.goBack();
        }
        await page.waitForTimeout(1500);
      } catch {
        await page.goBack();
        await page.waitForTimeout(1500);
      }
    }

    // Scroll for more
    if (leads.length >= maxLeads) break;
    const feed = page.locator('div[role="feed"]').first();
    if (await feed.isVisible({ timeout: 2000 })) {
      await feed.evaluate((el) => {
        el.scrollTop += el.clientHeight;
      });
    } else {
      await page.mouse.wheel(0, 600);
    }
    await page.waitForTimeout(2000);
  }

  return leads;
}
