# CRM v2 Test Guide

## Run API and multi-user CRM tests

```bash
npm run test:crm
```

## Required environment variables

- `CRM_V2_BASE_URL`: app URL (default `http://localhost:3000`)
- `CRM_V2_BEARER_TOKEN`: token for single-user API contract tests
- `CRM_V2_BEARER_TOKEN_USER_A`: token for user A (same shared org)
- `CRM_V2_BEARER_TOKEN_USER_B`: token for user B (same shared org)

If tokens are missing, tests are automatically skipped.

## Covered scenarios

- Board contract (`stages`, `opportunities`)
- Create opportunity + add activity + create task
- Reporting endpoint aggregate shape
- Multi-user shared-org read access
- Multi-user visibility of newly created opportunities
