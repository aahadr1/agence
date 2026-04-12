# CRM + Calendar Backend Verification (Local)

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (required for public booking and service-role routes)
- `CRM_V2_BASE_URL` (optional, defaults to `http://localhost:3000`)
- `CALENDAR_BASE_URL` (optional, defaults to `CRM_V2_BASE_URL` or `http://localhost:3000`)
- `CRM_V2_BEARER_TOKEN` (single-user API tests)
- `CRM_V2_BEARER_TOKEN_USER_A` and `CRM_V2_BEARER_TOKEN_USER_B` (multi-user CRM tests)
- `CALENDAR_BEARER_TOKEN` (calendar API tests; if missing, tests fall back to `CRM_V2_BEARER_TOKEN`)

## Validation commands

```bash
npm run lint
rm -f .next/lock && npm run build
npm run test:crm
npm run test:calendar
```

## Manual smoke checks

Use a bearer token in `TOKEN` and verify all commands return `200`/`201` with valid JSON payloads.

```bash
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/crm/v2/board
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/crm/v2/reporting
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/calendar/events
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/calendar/booking-links
```

## Pass criteria

- CRM board/reporting/opportunity endpoints return successful responses for authenticated users.
- Calendar events CRUD works for authenticated users.
- Booking links and public booking endpoints work when service-role key is configured.
- `npm run lint` passes (warnings allowed unless your CI treats them as errors).
- `npm run test:crm` and `npm run test:calendar` pass when required tokens are provided.
