import { tool } from "@opencode-ai/plugin";
import { newPage, closePage } from "./_shared";

export default tool({
  description:
    "Cherche un profil LinkedIn personnel via Google (site:linkedin.com/in). Évite de scraper LinkedIn directement (banni rapidement). Pour le dirigeant d'une entreprise.",
  args: {
    person_name: tool.schema.string(),
    business_name: tool.schema.string().optional(),
    location: tool.schema.string().optional(),
  },
  async execute(args) {
    const { page, ctx } = await newPage();
    try {
      const parts = [`"${args.person_name}"`];
      if (args.business_name) parts.push(`"${args.business_name}"`);
      if (args.location) parts.push(args.location);
      const q = encodeURIComponent(`${parts.join(" ")} site:linkedin.com/in`);

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

      const linkedinUrl = await page
        .locator('a[href*="linkedin.com/in/"]')
        .first()
        .getAttribute("href")
        .then((h) => {
          if (!h) return null;
          const m = h.match(/https?:\/\/[^&\s]*linkedin\.com\/in\/[^?&\s]+/i);
          return m ? m[0].split("?")[0] : null;
        })
        .catch(() => null);

      if (!linkedinUrl) {
        return { found: false };
      }

      // Get headline from Google snippet
      const snippet = await page
        .locator('a[href*="linkedin.com/in/"]')
        .first()
        .locator("xpath=ancestor::div[contains(@class,'g')]//div[contains(@class,'VwiC3b') or @data-sncf]")
        .first()
        .innerText()
        .catch(() => "");

      return {
        found: true,
        linkedin_url: linkedinUrl,
        headline: snippet.trim().slice(0, 300) || null,
      };
    } finally {
      await closePage(ctx);
    }
  },
});
