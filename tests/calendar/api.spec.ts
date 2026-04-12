import { expect, test } from "@playwright/test";

function authHeaders() {
  const token =
    process.env.CALENDAR_BEARER_TOKEN || process.env.CRM_V2_BEARER_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

test.describe("Calendar API contracts", () => {
  test("events CRUD works end-to-end", async ({ request }) => {
    const headers = authHeaders();
    test.skip(!headers, "CALENDAR_BEARER_TOKEN (or CRM_V2_BEARER_TOKEN) is required");

    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const title = `Calendar E2E ${Date.now()}`;

    const createRes = await request.post("/api/calendar/events", {
      headers: headers!,
      data: {
        title,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        visibility: "org",
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const eventId = created.event?.id as string | undefined;
    expect(eventId).toBeTruthy();

    const from = new Date(startsAt.getTime() - 60 * 1000).toISOString();
    const to = new Date(endsAt.getTime() + 60 * 1000).toISOString();
    const listRes = await request.get(`/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: headers!,
    });
    expect(listRes.ok()).toBeTruthy();
    const listed = await listRes.json();
    expect(Array.isArray(listed.events)).toBeTruthy();
    expect(listed.events.some((ev: { id: string }) => ev.id === eventId)).toBeTruthy();

    const patchTitle = `${title} (updated)`;
    const patchRes = await request.patch(`/api/calendar/events/${eventId}`, {
      headers: headers!,
      data: { title: patchTitle },
    });
    expect(patchRes.ok()).toBeTruthy();
    const patched = await patchRes.json();
    expect(patched.event?.title).toBe(patchTitle);

    const deleteRes = await request.delete(`/api/calendar/events/${eventId}`, {
      headers: headers!,
    });
    expect(deleteRes.ok()).toBeTruthy();
  });

  test("booking links + public booking create calendar event", async ({ request }) => {
    const headers = authHeaders();
    test.skip(!headers, "CALENDAR_BEARER_TOKEN (or CRM_V2_BEARER_TOKEN) is required");

    const createLinkRes = await request.post("/api/calendar/booking-links", {
      headers: headers!,
    });
    expect(createLinkRes.ok()).toBeTruthy();
    const createdLink = await createLinkRes.json();
    const slug = createdLink.link?.slug as string | undefined;
    expect(slug).toBeTruthy();

    const linksRes = await request.get("/api/calendar/booking-links", {
      headers: headers!,
    });
    expect(linksRes.ok()).toBeTruthy();
    const linksBody = await linksRes.json();
    expect(Array.isArray(linksBody.links)).toBeTruthy();
    expect(linksBody.links.some((l: { slug: string }) => l.slug === slug)).toBeTruthy();

    const publicMetaRes = await request.get(`/api/public/book/${slug}`);
    expect(publicMetaRes.ok()).toBeTruthy();
    const publicMeta = await publicMetaRes.json();
    expect(publicMeta.title).toBeTruthy();

    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const publicBookRes = await request.post(`/api/public/book/${slug}`, {
      data: {
        guestName: "Calendar API Test",
        guestEmail: "calendar-test@example.com",
        starts_at: startsAt.toISOString(),
      },
    });
    expect(publicBookRes.ok()).toBeTruthy();
    const publicBody = await publicBookRes.json();
    expect(publicBody.ok).toBeTruthy();
    expect(publicBody.eventId).toBeTruthy();
  });

  test("crm calendar-link creates meeting linked to opportunity", async ({ request }) => {
    const headers = authHeaders();
    test.skip(!headers, "CALENDAR_BEARER_TOKEN (or CRM_V2_BEARER_TOKEN) is required");

    const opportunityRes = await request.post("/api/crm/v2/opportunities", {
      headers: headers!,
      data: {
        title: `Calendar link opportunity ${Date.now()}`,
        source: "calendar_api_test",
      },
    });
    expect(opportunityRes.ok()).toBeTruthy();
    const opportunityBody = await opportunityRes.json();
    const opportunityId = opportunityBody.opportunity?.id as string | undefined;
    expect(opportunityId).toBeTruthy();

    const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 45 * 60 * 1000);
    const linkRes = await request.post("/api/crm/v2/calendar-link", {
      headers: headers!,
      data: {
        opportunity_id: opportunityId,
        title: `CRM linked meeting ${Date.now()}`,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      },
    });
    expect(linkRes.ok()).toBeTruthy();
    const linkBody = await linkRes.json();
    expect(linkBody.event?.id).toBeTruthy();
  });
});
