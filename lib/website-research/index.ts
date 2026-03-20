/**
 * Browser-based business research pipeline.
 * Uses Playwright + Gemini to browse Google Maps, the business website,
 * and Google Images — extracting rich data + photos for website creation.
 *
 * Inspired by the lead-generator stack, but focused on gathering
 * visual + content data instead of contact enrichment.
 */

import type { Page, BrowserContext } from "playwright-core";
import {
  launchBrowser,
  closeBrowser,
  screenshotToBase64,
  askGemini,
  normalizeUrl,
  type BrowserSession,
} from "../lead-agent/browser";

// ── Types ────────────────────────────────────────────────────

export interface ResearchImage {
  url: string;
  description: string;
  source: "maps" | "website" | "google-images";
  suggestedPlacement: string;
}

export interface WebsiteResearchResult {
  businessInfo: Record<string, unknown>;
  images: ResearchImage[];
  rawData: {
    mapsInfo: MapsBusinessInfo | null;
    websiteContent: string | null;
    reviews: string[];
  };
}

type Logger = (msg: string) => void;

// ── Google Maps ──────────────────────────────────────────────

interface MapsBusinessInfo {
  name: string;
  address: string;
  phone: string;
  hours: string;
  description: string;
  rating: string;
  review_count: string;
  cuisine_or_type: string;
  price_range: string;
  website_url: string | null;
  vibe: string;
  unique_features: string[];
}

interface MapsReview {
  text: string;
  rating: number;
  author: string;
}

async function researchGoogleMaps(
  page: Page,
  businessName: string,
  businessAddress: string,
  log: Logger
): Promise<{
  info: MapsBusinessInfo | null;
  photos: string[];
  reviews: MapsReview[];
}> {
  const query = `${businessName} ${businessAddress}`;
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  log("[Maps] Opening Google Maps...");
  await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);

  // Handle consent
  if (page.url().includes("consent.google.com")) {
    try {
      await page
        .locator('button:has-text("Tout accepter")')
        .first()
        .click();
      await page.waitForTimeout(3000);
    } catch {
      await page.goto(mapsUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(3000);
    }
  }

  // Wait for results
  await page
    .waitForSelector('div[role="feed"], div[role="main"]', { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(2000);

  // Click the first result
  try {
    const firstLink = page.locator('a[href*="/maps/place/"]').first();
    await firstLink.click();
    await page.waitForTimeout(3000);
  } catch {
    log("[Maps] Could not click listing");
  }

  // ── Extract business info ──
  log("[Maps] Extracting business details...");
  const infoScreenshot = await screenshotToBase64(page);

  let info: MapsBusinessInfo | null = null;
  try {
    info = await askGemini<MapsBusinessInfo>(
      `You are looking at a Google Maps business listing for "${businessName}".

Extract ALL visible information:
{
  "name": "exact business name",
  "address": "full street address",
  "phone": "phone number if visible",
  "hours": "opening hours if visible (Mon-Fri 9:00-18:00 format)",
  "description": "business description/category on Maps",
  "rating": "X.X" or "",
  "review_count": "number of reviews" or "",
  "cuisine_or_type": "type of business/cuisine (e.g. French restaurant, Hair salon)",
  "price_range": "price level (€, €€, €€€, €€€€)" or "",
  "website_url": "website URL if visible" or null,
  "vibe": "describe the atmosphere from what you can see",
  "unique_features": ["any standout features, awards, specialties"]
}

Return valid JSON only.`,
      infoScreenshot
    );
    log(`[Maps] Extracted info for: ${info.name}`);
  } catch (e) {
    log(`[Maps] Info extraction failed: ${e}`);
  }

  // ── Collect photos ──
  log("[Maps] Collecting photos...");
  const photos: string[] = [];

  try {
    // Click Photos tab
    const photosTab = page
      .locator(
        'button:has-text("Photos"), button:has-text("Photo"), button[aria-label*="photo" i]'
      )
      .first();

    if (await photosTab.isVisible({ timeout: 3000 })) {
      await photosTab.click();
      await page.waitForTimeout(3000);

      // Scroll to load more photos
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(1500);
      }

      // Extract photo URLs
      const photoUrls = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          'img[src*="googleusercontent"], img[src*="gstatic.com/mapfiles"]'
        );
        const urls: string[] = [];
        imgs.forEach((img) => {
          const src = (img as HTMLImageElement).src;
          if (
            src &&
            !src.includes("streetview") &&
            !src.includes("maps/vt") &&
            !src.includes("kh.google") &&
            !src.includes("maps.google")
          ) {
            // Upgrade to higher resolution
            const highRes = src
              .replace(/=w\d+-h\d+[^&]*/g, "=w1200-h900-no")
              .replace(/=s\d+[^&]*/g, "=s1200");
            urls.push(highRes);
          }
        });
        return [...new Set(urls)];
      });

      photos.push(...photoUrls.slice(0, 20));
      log(`[Maps] Found ${photos.length} photos`);

      // Go back
      await page.goBack();
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    log(`[Maps] Photo extraction failed: ${e}`);
  }

  // Fallback: grab any visible photos from the listing
  if (photos.length === 0) {
    try {
      const listingPhotos = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll('img[src*="googleusercontent"]')
        )
          .map((img) => (img as HTMLImageElement).src)
          .filter(
            (src) =>
              src &&
              !src.includes("streetview") &&
              !src.includes("maps/vt")
          )
          .map((src) =>
            src
              .replace(/=w\d+-h\d+[^&]*/g, "=w1200-h900-no")
              .replace(/=s\d+[^&]*/g, "=s1200")
          );
      });
      photos.push(...[...new Set(listingPhotos)].slice(0, 10));
    } catch {}
  }

  // ── Collect reviews ──
  log("[Maps] Reading reviews...");
  const reviews: MapsReview[] = [];

  try {
    const reviewsTab = page
      .locator(
        'button:has-text("Reviews"), button:has-text("Avis"), button[aria-label*="review" i], button[aria-label*="avis" i]'
      )
      .first();

    if (await reviewsTab.isVisible({ timeout: 3000 })) {
      await reviewsTab.click();
      await page.waitForTimeout(3000);

      // Scroll to load more reviews
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(1500);
      }

      // Expand truncated reviews
      const expandButtons = await page
        .locator('button:has-text("Plus"), button:has-text("More")')
        .all();
      for (const btn of expandButtons.slice(0, 5)) {
        try {
          await btn.click();
        } catch {}
      }
      await page.waitForTimeout(1000);

      const reviewScreenshot = await screenshotToBase64(page);

      const extracted = await askGemini<{ reviews: MapsReview[] }>(
        `You are looking at Google Maps reviews for "${businessName}".

Extract ALL visible reviews. Be thorough — capture the FULL text of each:
{
  "reviews": [
    { "text": "full review text — capture everything visible", "rating": 5, "author": "name" }
  ]
}

Return valid JSON only. Extract as many reviews as visible (up to 15).`,
        reviewScreenshot
      );

      reviews.push(...(extracted.reviews || []));
      log(`[Maps] Extracted ${reviews.length} reviews`);
    }
  } catch (e) {
    log(`[Maps] Review extraction failed: ${e}`);
  }

  return { info, photos, reviews };
}

// ── Website Crawl ────────────────────────────────────────────

interface WebsitePage {
  url: string;
  title: string;
  content: string;
  imageUrls: string[];
}

async function crawlBusinessWebsite(
  context: BrowserContext,
  websiteUrl: string,
  businessName: string,
  log: Logger
): Promise<{
  pages: WebsitePage[];
  designNotes: string;
  allImages: string[];
}> {
  const pages: WebsitePage[] = [];
  const allImages: string[] = [];
  let designNotes = "";

  const wsPage = await context.newPage();

  try {
    log(`[Website] Visiting: ${websiteUrl}`);
    await wsPage.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await wsPage.waitForTimeout(3000);

    // Screenshot homepage
    const homeScreenshot = await screenshotToBase64(wsPage);

    const homeAnalysis = await askGemini<{
      title: string;
      content: string;
      navigation_links: { text: string; href: string }[];
      design_notes: string;
      detected_colors: string[];
    }>(
      `You are looking at the homepage of "${businessName}" (${websiteUrl}).

Analyze EVERYTHING visible:
{
  "title": "page title",
  "content": "ALL visible text — headings, descriptions, taglines, menu items, prices, everything useful for recreating this website. Be very thorough.",
  "navigation_links": [
    { "text": "link text", "href": "URL or relative path" }
  ],
  "design_notes": "Describe the design: layout, colors, typography, style, feel. Modern or outdated? What works and what doesn't?",
  "detected_colors": ["#hex of main colors used"]
}

Return valid JSON only.`,
      homeScreenshot
    );

    pages.push({
      url: websiteUrl,
      title: homeAnalysis.title || "Homepage",
      content: homeAnalysis.content || "",
      imageUrls: [],
    });

    designNotes = homeAnalysis.design_notes || "";

    // Extract images from homepage
    const homeImages = await wsPage.evaluate(() => {
      return Array.from(document.querySelectorAll("img"))
        .map((img) => {
          const src =
            img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          return { src, w, h };
        })
        .filter(({ src, w, h }) => {
          if (!src || src.startsWith("data:")) return false;
          if (w > 0 && w < 80) return false;
          if (h > 0 && h < 80) return false;
          return true;
        })
        .map(({ src }) => src);
    });

    allImages.push(...homeImages);
    pages[0].imageUrls = homeImages;

    // Visit important sub-pages
    const navLinks = homeAnalysis.navigation_links || [];
    const importantPages = navLinks
      .filter((link) => {
        const combined = `${link.text || ""} ${link.href || ""}`.toLowerCase();
        return (
          /about|propos|histoire|story|notre|who|qui/i.test(combined) ||
          /menu|carte|plat|dish|food|boisson/i.test(combined) ||
          /service|prestation|offre|offer|tarif|price/i.test(combined) ||
          /galer|gallery|photo|portfolio|real/i.test(combined) ||
          /contact|nous.?joindre|reach|reservation/i.test(combined)
        );
      })
      .slice(0, 4);

    for (const link of importantPages) {
      try {
        const href = link.href.startsWith("http")
          ? link.href
          : new URL(link.href, websiteUrl).href;
        log(`[Website] Crawling: ${link.text}`);
        await wsPage.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });
        await wsPage.waitForTimeout(2000);

        const pageScreenshot = await screenshotToBase64(wsPage);

        const pageAnalysis = await askGemini<{
          title: string;
          content: string;
        }>(
          `You are looking at the "${link.text}" page of "${businessName}".

Extract ALL visible text content:
{
  "title": "page title",
  "content": "ALL text content — headings, descriptions, lists, prices, addresses. Organized by section."
}

Return valid JSON only.`,
          pageScreenshot
        );

        // Extract images
        const pageImages = await wsPage.evaluate(() => {
          return Array.from(document.querySelectorAll("img"))
            .map(
              (img) =>
                img.src ||
                img.getAttribute("data-src") ||
                img.getAttribute("data-lazy-src") ||
                ""
            )
            .filter(
              (src) => src && !src.startsWith("data:") && src.length > 10
            );
        });

        allImages.push(...pageImages);
        pages.push({
          url: href,
          title: pageAnalysis.title || link.text,
          content: pageAnalysis.content || "",
          imageUrls: pageImages,
        });
      } catch (e) {
        log(`[Website] Failed to crawl ${link.text}: ${e}`);
      }
    }
  } catch (e) {
    log(`[Website] Crawl error: ${e}`);
  } finally {
    await wsPage.close();
  }

  return { pages, designNotes, allImages: [...new Set(allImages)] };
}

// ── Google Images Search ─────────────────────────────────────

async function searchGoogleImages(
  page: Page,
  businessName: string,
  businessAddress: string,
  log: Logger
): Promise<string[]> {
  // Extract city from address for a tighter search
  const city =
    businessAddress
      .split(",")
      .map((p) => p.trim())
      .find((p) => p.length > 2 && !/^\d/.test(p)) || businessAddress;

  const query = `"${businessName}" ${city}`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&tbs=isz:l`;

  log("[Images] Searching Google Images...");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // Click a few thumbnails to trigger full-res loading
  const thumbnails = await page.locator("img.YQ4gaf, img.Q4LuWd, img.rg_i").all();
  for (let i = 0; i < Math.min(6, thumbnails.length); i++) {
    try {
      await thumbnails[i].click();
      await page.waitForTimeout(1200);
    } catch {}
  }

  // Extract image URLs
  const images = await page.evaluate(() => {
    const results: string[] = [];

    // Full-res images from the preview panel
    document
      .querySelectorAll(
        'img[src^="http"][class*="sFlh5c"], img[src^="http"][class*="iPVvYb"], img[src^="http"][class*="r48jcc"]'
      )
      .forEach((img) => {
        const src = (img as HTMLImageElement).src;
        if (src && src.startsWith("http") && !src.includes("gstatic.com/images")) {
          results.push(src);
        }
      });

    // Also collect from thumbnail data attributes
    document.querySelectorAll("a[href*='imgurl=']").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const match = href.match(/imgurl=([^&]+)/);
      if (match) {
        try {
          results.push(decodeURIComponent(match[1]));
        } catch {}
      }
    });

    // Fallback: grab any reasonably sized image
    if (results.length < 5) {
      document.querySelectorAll("img").forEach((img) => {
        const src = img.src;
        if (
          src &&
          src.startsWith("http") &&
          !src.includes("google.com") &&
          !src.includes("gstatic.com") &&
          img.naturalWidth > 200
        ) {
          results.push(src);
        }
      });
    }

    return [...new Set(results)];
  });

  // Filter out junk
  const filtered = images
    .filter((u) => {
      if (u.includes("favicon") || u.includes("1x1") || u.includes("pixel"))
        return false;
      if (u.includes("logo") && u.includes("google")) return false;
      return true;
    })
    .slice(0, 20);

  log(`[Images] Found ${filtered.length} images`);
  return filtered;
}

// ── Synthesis ────────────────────────────────────────────────

async function synthesizeBusinessProfile(
  businessName: string,
  businessAddress: string,
  mapsInfo: MapsBusinessInfo | null,
  reviews: MapsReview[],
  websitePages: WebsitePage[],
  designNotes: string,
  log: Logger
): Promise<Record<string, unknown>> {
  log("[Synthesis] Building deep business profile...");

  const reviewText = reviews
    .map((r) => `[${r.rating}★] ${r.author}: "${r.text}"`)
    .join("\n");

  const websiteText = websitePages
    .map((p) => `--- ${p.title} ---\n${p.content}`)
    .join("\n\n");

  const prompt = `You are an expert business analyst preparing a comprehensive brief for a web design team.
You have gathered real data about "${businessName}" at "${businessAddress}" by browsing Google Maps and their website.

=== GOOGLE MAPS DATA ===
${mapsInfo ? JSON.stringify(mapsInfo, null, 2) : "No Maps data available"}

=== CUSTOMER REVIEWS (${reviews.length} reviews) ===
${reviewText || "No reviews found"}

=== WEBSITE CONTENT ===
${websiteText || "No website found or could not be extracted"}

=== EXISTING DESIGN ANALYSIS ===
${designNotes || "No existing website"}

Create a COMPREHENSIVE, DEEPLY SPECIFIC business profile. Every field must reflect THIS specific business — not generic template text.

Return valid JSON:
{
  "name": "exact business name",
  "address": "full address",
  "phone": "phone number",
  "hours": "opening hours",
  "description": "3-4 sentence rich description — what they do, what makes them special, who they serve. Written as a warm introduction.",
  "cuisine": "specific type (e.g. 'Restaurant italien traditionnel', 'Salon de coiffure haut de gamme', 'Boulangerie artisanale bio')",
  "vibe": "2-3 vivid sentences about the atmosphere. Use sensory details — what you'd see, hear, smell, feel walking in.",
  "priceRange": "price level",
  "rating": "X.X",
  "uniqueSellingPoints": ["3-5 SPECIFIC differentiators — not 'great service' but 'house-made pasta from grandmother's Neapolitan recipe'"],
  "customerSentiment": "2-3 sentences synthesizing overall customer feeling. What gets mentioned repeatedly?",
  "reviewHighlights": ["5-8 actual memorable quotes from reviews"],
  "menu": "If restaurant: real menu items with prices. If service business: services with descriptions and prices. Be as detailed as possible from the data you have.",
  "colors": ["brand colors detected — hex values"],
  "socialMedia": {
    "instagram": "URL if found",
    "facebook": "URL if found",
    "website": "URL if found"
  },
  "competitors": "Who are their competitors in the area? What makes this business different?",
  "neighborhood": "Describe the neighborhood — what kind of area is this?"
}

Be exhaustive. Every detail matters for the design team.`;

  const result = await askGemini<Record<string, unknown>>(prompt);
  return result;
}

// ── Main Pipeline ────────────────────────────────────────────

export async function runWebsiteResearch(
  businessName: string,
  businessAddress: string,
  log: Logger = console.log
): Promise<WebsiteResearchResult> {
  let session: BrowserSession | null = null;

  try {
    session = await launchBrowser();

    // Phase 1: Google Maps deep dive
    log("=== Phase 1/4: Google Maps research ===");
    const mapsResult = await researchGoogleMaps(
      session.page,
      businessName,
      businessAddress,
      log
    );

    // Phase 2: Crawl business website (if found)
    const websiteUrl = normalizeUrl(mapsResult.info?.website_url);
    let websiteResult: {
      pages: WebsitePage[];
      designNotes: string;
      allImages: string[];
    } | null = null;

    if (websiteUrl) {
      log("=== Phase 2/4: Crawling business website ===");
      websiteResult = await crawlBusinessWebsite(
        session.context,
        websiteUrl,
        businessName,
        log
      );
    } else {
      log("=== Phase 2/4: No website found — skipping crawl ===");
    }

    // Phase 3: Google Images
    log("=== Phase 3/4: Google Images search ===");
    const googleImages = await searchGoogleImages(
      session.page,
      businessName,
      businessAddress,
      log
    );

    // Phase 4: Gemini synthesis
    log("=== Phase 4/4: Deep synthesis ===");
    const businessInfo = await synthesizeBusinessProfile(
      businessName,
      businessAddress,
      mapsResult.info,
      mapsResult.reviews,
      websiteResult?.pages || [],
      websiteResult?.designNotes || "",
      log
    );

    // ── Combine images ──
    const allImages: ResearchImage[] = [];

    // Maps photos — highest quality, from the actual business
    for (const url of mapsResult.photos) {
      allImages.push({
        url,
        description: "Business photo from Google Maps",
        source: "maps",
        suggestedPlacement: allImages.length === 0 ? "hero" : "gallery",
      });
    }

    // Website images — authentic business imagery
    if (websiteResult) {
      for (const url of websiteResult.allImages.slice(0, 15)) {
        allImages.push({
          url,
          description: "Image from business website",
          source: "website",
          suggestedPlacement: "gallery",
        });
      }
    }

    // Google Images — supplementary
    for (const url of googleImages.slice(0, 10)) {
      allImages.push({
        url,
        description: "Business image from Google",
        source: "google-images",
        suggestedPlacement: "gallery",
      });
    }

    log(
      `Research complete: ${Object.keys(businessInfo).length} fields, ${allImages.length} images found`
    );

    return {
      businessInfo,
      images: allImages,
      rawData: {
        mapsInfo: mapsResult.info,
        websiteContent:
          websiteResult?.pages
            .map((p) => `${p.title}: ${p.content}`)
            .join("\n\n") || null,
        reviews: mapsResult.reviews.map(
          (r) => `${r.author} (${r.rating}★): ${r.text}`
        ),
      },
    };
  } finally {
    if (session) {
      await closeBrowser(session);
    }
  }
}
