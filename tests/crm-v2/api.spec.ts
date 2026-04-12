import { expect, test } from "@playwright/test";

const baseApiHeaders = () => {
  const token = process.env.CRM_V2_BEARER_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

test.describe("CRM v2 API contracts", () => {
  test("board endpoint returns stages/opportunities", async ({ request }) => {
    const headers = baseApiHeaders();
    test.skip(!headers, "CRM_V2_BEARER_TOKEN is required");

    const res = await request.get("/api/crm/v2/board", { headers: headers! });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.stages)).toBeTruthy();
    expect(Array.isArray(body.opportunities)).toBeTruthy();
  });

  test("create opportunity -> add note -> create task", async ({ request }) => {
    const headers = baseApiHeaders();
    test.skip(!headers, "CRM_V2_BEARER_TOKEN is required");

    const createRes = await request.post("/api/crm/v2/opportunities", {
      headers: headers!,
      data: { title: `E2E prospect ${Date.now()}`, source: "test" },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    const opportunityId = createBody.opportunity?.id as string;
    expect(opportunityId).toBeTruthy();

    const noteRes = await request.post(
      `/api/crm/v2/opportunities/${opportunityId}/activities`,
      {
        headers: headers!,
        data: { type: "note", body: "Playwright API test note" },
      }
    );
    expect(noteRes.ok()).toBeTruthy();

    const taskRes = await request.post("/api/crm/v2/tasks", {
      headers: headers!,
      data: {
        title: `Follow-up ${Date.now()}`,
        opportunity_id: opportunityId,
        priority: "high",
      },
    });
    expect(taskRes.ok()).toBeTruthy();
  });

  test("reporting endpoint returns aggregates", async ({ request }) => {
    const headers = baseApiHeaders();
    test.skip(!headers, "CRM_V2_BEARER_TOKEN is required");

    const res = await request.get("/api/crm/v2/reporting", { headers: headers! });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.funnel)).toBeTruthy();
    expect(Array.isArray(body.ownerPerformance)).toBeTruthy();
    expect(body.taskSummary).toBeTruthy();
  });
});
