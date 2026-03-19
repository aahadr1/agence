import { chromium, type Browser, type Page } from "playwright";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface LeadResult {
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
  source: string;
}

interface GeminiBusinessList {
  businesses: {
    name: string;
    index: number;
  }[];
  has_more: boolean;
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

const GEMINI_MODEL = "gemini-2.5-flash";

function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL });
}

async function screenshotToBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
  return buffer.toString("base64");
}

async function askGemini<T>(prompt: string, imageBase64: string): Promise<T> {
  const model = getGemini();
  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    },
  ]);

  const text = result.response.text().trim();
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(jsonStr) as T;
}

async function waitForMapsResults(page: Page) {
  // Wait for the results feed to appear
  await page.waitForSelector('div[role="feed"], div[role="main"]', {
    timeout: 15000,
  }).catch(() => {});
  // Extra time for results to fully render
  await page.waitForTimeout(2000);
}

/**
 * Main agent: opens Google Maps, searches for businesses,
 * clicks through each one, and uses Gemini to extract details.
 */
export async function runLeadAgent(
  niche: string,
  location: string,
  onProgress?: (msg: string) => void
): Promise<LeadResult[]> {
  const log = (msg: string) => {
    console.log(`[lead-agent] ${msg}`);
    onProgress?.(msg);
  };

  let browser: Browser | null = null;
  const leads: LeadResult[] = [];
  const seenNames = new Set<string>();

  try {
    // 1. Launch browser
    log("Launching browser...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
    });

    // Pre-set Google consent cookie to skip the consent page
    await context.addCookies([
      {
        name: "CONSENT",
        value: "YES+cb.20240101-00-p0.en+FX+999",
        domain: ".google.com",
        path: "/",
      },
      {
        name: "SOCS",
        value: "CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmVuIAEaBgiA_LyuBg",
        domain: ".google.com",
        path: "/",
      },
    ]);

    const page = await context.newPage();

    // 2. Navigate directly to Google Maps search (skips most consent issues)
    const query = `${niche} in ${location}`;
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    log(`Opening Google Maps: "${query}"`);

    await page.goto(mapsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(2000);

    // Handle Google consent page if it appears
    if (page.url().includes("consent.google.com")) {
      log("Handling Google consent page...");
      // Try multiple selectors for the accept button
      const acceptSelectors = [
        'button:has-text("Tout accepter")',
        'button:has-text("Accept all")',
        'button:has-text("Akzeptieren")',
        'form[action*="consent"] button:last-of-type',
      ];
      for (const sel of acceptSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            log("Consent accepted");
            await page.waitForTimeout(3000);
            break;
          }
        } catch {
          // Try next selector
        }
      }

      // If still on consent page, try submitting the accept form directly
      if (page.url().includes("consent.google.com")) {
        try {
          await page.locator('form[action*="consent"]').first()
            .locator('button').last().click();
          await page.waitForTimeout(3000);
        } catch {
          // Force navigate past consent
          log("Forcing navigation past consent...");
          await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(2000);
        }
      }
    }

    // If we're still not on Maps, try with cookies pre-set
    if (!page.url().includes("google.com/maps")) {
      log("Setting consent cookie and retrying...");
      await context.addCookies([
        {
          name: "CONSENT",
          value: "YES+cb.20240101-00-p0.en+FX+999",
          domain: ".google.com",
          path: "/",
        },
      ]);
      await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
    }

    log("Waiting for Maps results to load...");
    await waitForMapsResults(page);

    // 4. Scroll through results and extract businesses
    const MAX_SCROLLS = 5;
    const MAX_LEADS = 30;

    for (let scroll = 0; scroll < MAX_SCROLLS && leads.length < MAX_LEADS; scroll++) {
      log(`Scanning results (page ${scroll + 1}/${MAX_SCROLLS})...`);

      // Get all place links on the page for reliable clicking
      const placeLinks = await page.locator('a[href*="/maps/place/"]').all();

      if (placeLinks.length === 0) {
        log("No business links found on page");
        break;
      }

      log(`Found ${placeLinks.length} business links on screen`);

      for (let i = 0; i < placeLinks.length && leads.length < MAX_LEADS; i++) {
        const link = placeLinks[i];
        let ariaLabel = "";
        try {
          ariaLabel = (await link.getAttribute("aria-label")) || "";
        } catch { continue; }

        if (!ariaLabel || seenNames.has(ariaLabel.toLowerCase())) continue;

        log(`Checking: ${ariaLabel}...`);

        try {
          await link.click();
        } catch {
          log(`  Click failed for "${ariaLabel}", skipping`);
          continue;
        }

        // Wait for details panel
        await page.waitForTimeout(2500);

        // Get the current URL (Google Maps URL for this business)
        const currentUrl = page.url();

        // Screenshot the details panel and extract info with Gemini
        const detailScreenshot = await screenshotToBase64(page);

        try {
          const details = await askGemini<GeminiBusinessDetails>(
            `You are looking at a Google Maps business detail panel/page.

Extract ALL available information about this business:

{
  "business_name": "exact name",
  "description": "type/category of business, any tagline or description shown",
  "address": "full address if visible",
  "phone": "phone number if visible (include country code format)",
  "email": "email if visible (rare on Maps)",
  "rating": "X.X" (the star rating) or null,
  "review_count": "number" (total reviews) or null,
  "review_highlights": ["up to 3 short review snippets if visible"],
  "has_website": true/false — CRITICAL: is there a "Website" button or link visible? Look carefully for a globe icon or "Website" text in the action buttons (usually near Directions, Save, etc). If there is NO website button/link, set to false,
  "website_url": "the URL if visible" or null
}

Be PRECISE about has_website — this is the most important field. Only set true if you can clearly see a Website button/link.

Return JSON only, no markdown.`,
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
            website_url: details.website_url,
            google_maps_url: currentUrl,
            source: "Google Maps",
          });

          const websiteStatus = details.has_website ? "has website" : "NO WEBSITE";
          log(`  ✓ ${details.business_name || ariaLabel} — ${websiteStatus}`);
        } catch (e) {
          log(`  Failed to extract details for "${ariaLabel}": ${e}`);
        }

        // Go back to results list
        try {
          const backBtn = page.locator('button[aria-label="Back"], button[jsaction*="back"]').first();
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

      // 6. Scroll down for more results
      if (leads.length >= MAX_LEADS) break;

      log("Scrolling for more results...");
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

    log(`Done! Found ${leads.length} businesses total`);
    return leads;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
