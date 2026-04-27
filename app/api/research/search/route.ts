import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { withBrowserSession, safeGoto } from "@/lib/lead-agent/browser";
import {
  extractRenderedText,
  searchWebWithBrowser,
} from "@/lib/agent/tools/v1-browser-utils";

export const maxDuration = 60;

type ResearchSearch = {
  label: string;
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
};

async function collectImagesFromPage(pageUrl: string) {
  return withBrowserSession(async (session) => {
    const ok = await safeGoto(session.page, pageUrl);
    if (!ok) return [];
    return session.page.evaluate(() => {
      const out: Array<{ url: string; description: string }> = [];
      const add = (url: string | null | undefined, description: string) => {
        if (!url) return;
        try {
          const absolute = new URL(url, location.href).toString();
          if (
            /favicon|sprite|avatar|icon/i.test(absolute) ||
            !/\.(jpe?g|png|webp)(\?|$)|photo|image|media|upload|cdn/i.test(
              absolute,
            )
          ) {
            return;
          }
          if (!out.some((x) => x.url === absolute)) {
            out.push({ url: absolute, description });
          }
        } catch {
          /* skip */
        }
      };

      add(
        document
          .querySelector<HTMLMetaElement>('meta[property="og:image"]')
          ?.content,
        "OpenGraph image",
      );
      document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        add(img.currentSrc || img.src, img.alt || document.title || "");
      });
      return out.slice(0, 10);
    });
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { businessName, businessAddress } = await request.json();

  if (!businessName || !businessAddress) {
    return NextResponse.json(
      { error: "Business name and address are required" },
      { status: 400 },
    );
  }

  try {
    const city =
      String(businessAddress).split(",").slice(-2, -1)[0]?.trim() ||
      String(businessAddress);

    const searches = await withBrowserSession(async (session) => {
      const plans = [
        { label: "GENERAL INFORMATION", query: `"${businessName}" ${businessAddress}` },
        {
          label: "CUSTOMER REVIEWS & SENTIMENT",
          query: `"${businessName}" ${city} avis reviews clients google tripadvisor yelp`,
        },
        {
          label: "MENU, SERVICES & PRICES",
          query: `"${businessName}" ${city} menu carte services tarifs prix horaires`,
        },
        {
          label: "SOCIAL MEDIA & WEB PRESENCE",
          query: `"${businessName}" site officiel instagram facebook telephone email contact`,
        },
        {
          label: "IMAGES",
          query: `"${businessName}" ${city} photos images interieur`,
        },
        {
          label: "LOCATION & GOOGLE MAPS DATA",
          query: `"${businessName}" ${businessAddress} google maps fiche etablissement horaires`,
        },
      ];

      const out: ResearchSearch[] = [];
      for (const plan of plans) {
        const res = await searchWebWithBrowser(session.page, plan.query, 10, "google");
        out.push({ ...plan, results: res.results });
      }
      return out;
    });

    const imageCandidates = new Map<string, string>();
    const imagePages = searches
      .flatMap((s) => s.results)
      .slice(0, 8)
      .map((r) => r.url);
    for (const url of imagePages) {
      const imgs = await collectImagesFromPage(url).catch(() => []);
      for (const img of imgs) {
        if (imageCandidates.size >= 25) break;
        if (!imageCandidates.has(img.url)) {
          imageCandidates.set(img.url, img.description || "");
        }
      }
    }

    const pageSummaries = await withBrowserSession(async (session) => {
      const summaries: Record<string, string> = {};
      const urls = searches.flatMap((s) => s.results.slice(0, 2).map((r) => r.url));
      for (const url of urls) {
        if (summaries[url]) continue;
        const ok = await safeGoto(session.page, url);
        if (!ok) continue;
        const rendered = await extractRenderedText(session.page, 2500);
        summaries[url] = rendered.text;
      }
      return summaries;
    });

    const foundImages = [...imageCandidates.entries()].map(
      ([url, description]) => ({ url, description }),
    );

    const rawResearch = searches
      .map((s) => {
        const sources = s.results
          .map(
            (r) =>
              `- [${r.title}] ${r.url}\n  ${r.snippet || pageSummaries[r.url] || ""}`,
          )
          .join("\n");
        return `=== ${s.label} ===\nQuery: ${s.query}\n\nSources:\n${sources}`;
      })
      .join("\n\n")
      .concat(
        `\n\n=== IMAGES FOUND (${foundImages.length} images) ===\n${foundImages
          .map((img, i) => `Image ${i + 1}: ${img.url} - ${img.description || "no description"}`)
          .join("\n")}`,
      );

    return NextResponse.json({ rawResearch, foundImages });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Search failed";
    console.error("Research search error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
