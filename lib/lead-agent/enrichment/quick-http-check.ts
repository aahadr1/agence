/**
 * Fast, no-browser website check.
 * Issues a HEAD request (with GET fallback) to determine whether a site is
 * alive, whether it uses HTTPS, and whether it redirects to another domain.
 *
 * Takes ~1-3 s vs 15 s for a full Playwright navigation.
 */

export interface QuickHttpResult {
  is_alive: boolean;
  has_https: boolean;
  final_url: string | null;
  redirected_to_other_domain: boolean;
}

function parseDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function quickHttpCheck(
  websiteUrl: string | null,
  log: (msg: string) => void
): Promise<QuickHttpResult | null> {
  if (!websiteUrl) return null;

  let url = websiteUrl.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  const originalDomain = parseDomain(url);

  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; LeadAgent/1.0; +https://lahaut.agency)",
        },
      });

      const finalUrl = res.url || url;
      const finalDomain = parseDomain(finalUrl);
      const has_https = finalUrl.startsWith("https://");
      const is_alive = res.status < 400;
      const redirected_to_other_domain =
        !!originalDomain &&
        !!finalDomain &&
        finalDomain !== originalDomain;

      log(
        `[HttpCheck] ${is_alive ? "✓" : "✗"} ${res.status} | HTTPS:${has_https} | domain:${finalDomain}`
      );

      return { is_alive, has_https, final_url: finalUrl, redirected_to_other_domain };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (method === "GET") {
        log(`[HttpCheck] ✗ ${msg.slice(0, 80)}`);
      }
    }
  }

  return { is_alive: false, has_https: false, final_url: null, redirected_to_other_domain: false };
}
