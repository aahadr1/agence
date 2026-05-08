import { tool } from "@opencode-ai/plugin";
import { newPage, closePage } from "./_shared";

export default tool({
  description:
    "Cherche la page Facebook d'une entreprise. Retourne URL FB, nb followers, présence d'ads Meta. Lent (15-25s). Utilise après avoir le nom + ville.",
  args: {
    business_name: tool.schema.string(),
    location: tool.schema.string(),
    owner_name: tool.schema.string().optional(),
  },
  async execute(args) {
    const { page, ctx } = await newPage();
    try {
      // Search via Google to find the FB page (more reliable than searching FB directly)
      const q = encodeURIComponent(`"${args.business_name}" ${args.location} site:facebook.com`);
      await page.goto(`https://www.google.com/search?q=${q}&hl=fr`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      try {
        await page
          .getByRole("button", { name: /tout accepter/i })
          .first()
          .click({ timeout: 3000 });
      } catch {}

      const fbUrl = await page
        .locator('a[href*="facebook.com/"]:not([href*="facebook.com/sharer"])')
        .first()
        .getAttribute("href")
        .then((h) => {
          if (!h) return null;
          const m = h.match(/https?:\/\/[^&\s]*facebook\.com\/[^?&\s]+/i);
          return m ? m[0] : null;
        })
        .catch(() => null);

      if (!fbUrl) {
        return { found: false, reason: "no_facebook_page" };
      }

      // Visit FB page
      await page.goto(fbUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const followers =
          text.match(/(\d[\d\s.,]*)\s*(personnes? aiment|followers?|abonnés?|j'aime)/i)?.[1] ?? null;
        const igMatch = document.querySelector('a[href*="instagram.com/"]') as HTMLAnchorElement | null;
        const websiteMatch = Array.from(document.querySelectorAll("a")).find(
          (a) => /^https?:\/\//i.test(a.href) && !/facebook\.com|instagram\.com|fb\.me/.test(a.href),
        ) as HTMLAnchorElement | undefined;
        return {
          followers,
          instagram: igMatch?.href ?? null,
          website: websiteMatch?.href ?? null,
        };
      });

      // Quick check ad library
      let adsCount = 0;
      try {
        const fbId = fbUrl.match(/facebook\.com\/(?:pg\/)?([^/?]+)/)?.[1];
        if (fbId) {
          await page.goto(
            `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=FR&search_type=page&q=${encodeURIComponent(args.business_name)}`,
            { waitUntil: "domcontentloaded", timeout: 20_000 },
          );
          await page.waitForTimeout(2500);
          const txt = await page.evaluate(() => document.body.innerText.slice(0, 5000));
          const m = txt.match(/(\d[\d\s.,]*)\s*(résultats|results)/i);
          if (m) adsCount = parseInt(m[1].replace(/[^\d]/g, ""), 10) || 0;
        }
      } catch {}

      return {
        found: true,
        facebook_url: fbUrl,
        instagram_url: data.instagram,
        website_url: data.website,
        follower_count: data.followers ? parseInt(data.followers.replace(/[^\d]/g, ""), 10) || null : null,
        has_meta_ads: adsCount > 0,
        meta_ads_count: adsCount,
      };
    } finally {
      await closePage(ctx);
    }
  },
});
