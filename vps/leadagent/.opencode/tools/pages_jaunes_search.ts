import { tool } from "@opencode-ai/plugin";
import { newPage, closePage } from "./_shared";

export default tool({
  description:
    "Cherche une entreprise dans Pages Jaunes. Retourne téléphone, email, adresse, site web. Utile pour les coordonnées que les APIs n'ont pas.",
  args: {
    query: tool.schema.string().describe("Nom de l'entreprise"),
    location: tool.schema.string().describe("Ville"),
    phone_hint: tool.schema.string().optional(),
  },
  async execute(args) {
    const { page, ctx } = await newPage();
    try {
      const url = `https://www.pagesjaunes.fr/recherche/${encodeURIComponent(args.location)}/${encodeURIComponent(args.query)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      // Cookie banner
      try {
        await page.locator("#didomi-notice-agree-button").click({ timeout: 3000 });
      } catch {}

      const firstResult = page.locator("article.bi-bloc, li.bi-bloc, .bi-bloc").first();
      if ((await firstResult.count()) === 0) {
        return { found: false, reason: "no_results" };
      }

      const data = await firstResult.evaluate((el) => {
        const text = (sel: string) =>
          (el.querySelector(sel)?.textContent ?? "").trim() || null;
        const attr = (sel: string, a: string) =>
          (el.querySelector(sel) as HTMLAnchorElement | null)?.getAttribute(a) ?? null;
        return {
          name: text("h2, h3, .denomination-links, .denomination"),
          address: text(".bi-address, address"),
          phone:
            text(".coord-numero, .number-contact") ??
            attr("a[href^='tel:']", "href")?.replace(/^tel:/, "") ??
            null,
          website: attr("a[data-pjlb], a.lien-site-internet, a[href*='http']", "href"),
          category: text(".bi-activity, .activity"),
        };
      });

      // Fetch detail page if no email/website
      let email: string | null = null;
      try {
        const detailUrl = await firstResult
          .locator("a.denomination-links, h2 a, h3 a")
          .first()
          .getAttribute("href");
        if (detailUrl && !data.website) {
          const full = detailUrl.startsWith("http") ? detailUrl : `https://www.pagesjaunes.fr${detailUrl}`;
          await page.goto(full, { waitUntil: "domcontentloaded", timeout: 20_000 });
          email = await page
            .locator("a[href^='mailto:']")
            .first()
            .getAttribute("href")
            .then((h) => h?.replace(/^mailto:/, "").trim() ?? null)
            .catch(() => null);
        }
      } catch {}

      return {
        found: !!data.name,
        name: data.name,
        phone: data.phone,
        email,
        address: data.address,
        website_url: data.website && !data.website.includes("pagesjaunes.fr") ? data.website : null,
        category: data.category,
      };
    } finally {
      await closePage(ctx);
    }
  },
});
