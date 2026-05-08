import { tool } from "@opencode-ai/plugin";
import { newPage, closePage } from "./_shared";

export default tool({
  description:
    "Audite la qualité d'un site web : HTTPS, présence de booking, chatbot, mobile-friendly, qualité globale. Retourne un score 0-100 et un label (none/dead/outdated/poor/decent/good).",
  args: {
    url: tool.schema.string().url(),
  },
  async execute(args) {
    const { page, ctx } = await newPage();
    try {
      let response;
      try {
        response = await page.goto(args.url, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });
      } catch {
        return {
          quality: "dead",
          score: 0,
          has_https: args.url.startsWith("https://"),
          reason: "load_failed",
        };
      }

      const status = response?.status() ?? 0;
      if (status >= 400) {
        return {
          quality: "dead",
          score: 0,
          has_https: args.url.startsWith("https://"),
          status,
        };
      }

      const has_https = page.url().startsWith("https://");

      const audit = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        const html = document.documentElement.outerHTML.toLowerCase();

        const has_booking = /\b(réserver|reserver|book ?online|prendre rendez-?vous|calendly|opentable|thefork|guestonline)\b/.test(
          text,
        );
        const has_chatbot = /(intercom|crisp|drift|tawk|tidio|zendesk|chatra|olark)\.(com|io)/.test(
          html,
        );
        const has_viewport = !!document.querySelector('meta[name="viewport"]');
        const meta_desc = !!document.querySelector('meta[name="description"]');
        const has_og = !!document.querySelector('meta[property^="og:"]');
        const num_images = document.images.length;
        const num_links = document.querySelectorAll("a[href]").length;
        const text_len = document.body.innerText.length;

        // Crude detection of legacy designs (table-based layouts, no CSS)
        const styles_count = document.querySelectorAll(
          "link[rel='stylesheet'], style",
        ).length;

        return {
          has_booking,
          has_chatbot,
          has_viewport,
          meta_desc,
          has_og,
          num_images,
          num_links,
          text_len,
          styles_count,
        };
      });

      // Compute score
      let score = 50;
      if (has_https) score += 10;
      if (audit.has_viewport) score += 10;
      if (audit.meta_desc) score += 5;
      if (audit.has_og) score += 5;
      if (audit.styles_count >= 1) score += 5;
      if (audit.num_images >= 3) score += 5;
      if (audit.text_len > 800) score += 5;
      if (audit.has_booking) score += 5;
      score = Math.min(100, Math.max(0, score));

      let quality: "good" | "decent" | "poor" | "outdated" =
        score >= 80 ? "good" : score >= 60 ? "decent" : score >= 40 ? "poor" : "outdated";

      return {
        quality,
        score,
        has_https,
        has_booking: audit.has_booking,
        has_chatbot: audit.has_chatbot,
        is_responsive: audit.has_viewport,
        has_meta_description: audit.meta_desc,
        signals: audit,
      };
    } finally {
      await closePage(ctx);
    }
  },
});
