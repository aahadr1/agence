import { tool } from "@opencode-ai/plugin";
import { newPage, closePage } from "./_shared";

interface MapsLead {
  business_name: string;
  address: string | null;
  phone: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  rating: string | null;
  review_count: string | null;
  category: string | null;
}

export default tool({
  description:
    "Scrape Google Maps pour une recherche donnée (ex: 'restaurant Lyon 2'). Retourne jusqu'à N entreprises avec leurs infos visibles. Lent (10-30s) mais très fiable.",
  args: {
    query: tool.schema.string().describe("Requête Maps complète, ex: 'salon de coiffure Lyon 2'"),
    max_results: tool.schema.number().default(20).describe("Cible max (10-50 conseillé)"),
  },
  async execute(args) {
    const { page, ctx } = await newPage();
    const max = Math.min(Math.max(args.max_results ?? 20, 5), 50);
    try {
      const url = `https://www.google.com/maps/search/${encodeURIComponent(args.query)}/?hl=fr`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });

      // Consent banner
      try {
        await page
          .getByRole("button", { name: /tout accepter|accept all/i })
          .first()
          .click({ timeout: 3000 });
      } catch {}

      // Wait for results pane
      const feed = page.locator('div[role="feed"]');
      try {
        await feed.waitFor({ timeout: 10_000 });
      } catch {
        return { found: 0, leads: [], reason: "feed_timeout" };
      }

      const leads: MapsLead[] = [];
      const seen = new Set<string>();
      let scrolls = 0;
      while (leads.length < max && scrolls < 12) {
        const items = page.locator('div[role="feed"] > div > div[jsaction*="mouseover"]');
        const count = await items.count();
        for (let i = 0; i < count && leads.length < max; i++) {
          const item = items.nth(i);
          const data = await item.evaluate((el) => {
            const text = (sel: string) =>
              (el.querySelector(sel)?.textContent ?? "").trim() || null;
            const aria = (el.querySelector("a[aria-label]") as HTMLAnchorElement | null)
              ?.getAttribute("aria-label") ?? null;
            const href = (el.querySelector("a[href*='/place/']") as HTMLAnchorElement | null)?.href ?? null;
            const attrs = el.querySelectorAll(".W4Efsd > span, .fontBodyMedium > div > span");
            const labels: string[] = [];
            attrs.forEach((s) => {
              const t = (s.textContent ?? "").trim();
              if (t && !labels.includes(t)) labels.push(t);
            });
            return {
              name: aria || text("div.fontHeadlineSmall, .qBF1Pd, .NrDZNb"),
              maps_url: href,
              labels,
              ratingText: text(".MW4etd, span.fontBodyMedium > span") ?? null,
              reviewText: text(".UY7F9, span.fontBodyMedium > span:nth-child(2)") ?? null,
            };
          });
          if (!data.name || seen.has(data.name)) continue;
          seen.add(data.name);

          // Click to get more info (phone, website)
          let phone: string | null = null;
          let website: string | null = null;
          let address: string | null = null;
          try {
            await item.click({ timeout: 5000 });
            await page.waitForTimeout(1500);
            const detail = page.locator("div[role='main']");
            address = await detail
              .locator("button[data-item-id='address']")
              .first()
              .getAttribute("aria-label")
              .then((s) => s?.replace(/^Adresse\s*:\s*/, "").trim() ?? null)
              .catch(() => null);
            phone = await detail
              .locator("button[data-item-id^='phone']")
              .first()
              .getAttribute("aria-label")
              .then((s) => s?.replace(/^Téléphone\s*:\s*/, "").replace(/\s+/g, " ").trim() ?? null)
              .catch(() => null);
            website = await detail
              .locator("a[data-item-id='authority']")
              .first()
              .getAttribute("href")
              .catch(() => null);
          } catch {}

          leads.push({
            business_name: data.name,
            address,
            phone,
            website_url: website,
            google_maps_url: data.maps_url,
            rating: data.ratingText,
            review_count: data.reviewText,
            category: data.labels.find((l) => /restaurant|salon|boutique|bar|café|garage|coiffeur/i.test(l)) ?? data.labels[0] ?? null,
          });
        }

        // Scroll the feed
        await feed.evaluate((el) => (el as HTMLElement).scrollBy(0, 1500)).catch(() => {});
        await page.waitForTimeout(800);
        scrolls++;
      }

      return { found: leads.length, leads };
    } finally {
      await closePage(ctx);
    }
  },
});
