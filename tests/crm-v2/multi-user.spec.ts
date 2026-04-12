import { expect, test } from "@playwright/test";

function authHeader(token: string | undefined) {
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

test.describe("CRM v2 multi-user shared agency", () => {
  test("two users can read same board", async ({ request }) => {
    const userAToken = process.env.CRM_V2_BEARER_TOKEN_USER_A;
    const userBToken = process.env.CRM_V2_BEARER_TOKEN_USER_B;
    const headersA = authHeader(userAToken);
    const headersB = authHeader(userBToken);
    test.skip(!headersA || !headersB, "Set CRM_V2_BEARER_TOKEN_USER_A and _USER_B");

    const [aRes, bRes] = await Promise.all([
      request.get("/api/crm/v2/board", { headers: headersA! }),
      request.get("/api/crm/v2/board", { headers: headersB! }),
    ]);

    expect(aRes.ok()).toBeTruthy();
    expect(bRes.ok()).toBeTruthy();

    const aBody = await aRes.json();
    const bBody = await bRes.json();
    expect(Array.isArray(aBody.stages)).toBeTruthy();
    expect(Array.isArray(bBody.stages)).toBeTruthy();
    expect(aBody.stages.length).toBeGreaterThan(0);
    expect(bBody.stages.length).toBeGreaterThan(0);
  });

  test("user A creates opportunity, user B can fetch it", async ({ request }) => {
    const userAToken = process.env.CRM_V2_BEARER_TOKEN_USER_A;
    const userBToken = process.env.CRM_V2_BEARER_TOKEN_USER_B;
    const headersA = authHeader(userAToken);
    const headersB = authHeader(userBToken);
    test.skip(!headersA || !headersB, "Set CRM_V2_BEARER_TOKEN_USER_A and _USER_B");

    const createRes = await request.post("/api/crm/v2/opportunities", {
      headers: headersA!,
      data: { title: `Shared prospect ${Date.now()}`, source: "multi_user_test" },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const opportunityId = created.opportunity?.id as string;
    expect(opportunityId).toBeTruthy();

    const readRes = await request.get(`/api/crm/v2/opportunities/${opportunityId}`, {
      headers: headersB!,
    });
    expect(readRes.ok()).toBeTruthy();
    const readBody = await readRes.json();
    expect(readBody.opportunity?.id).toBe(opportunityId);
  });
});
