# Guide — Deployment

```bash
npm run build
npm run start
```

## Rollback

Redeploy a previous version from your hosting provider, or `git checkout <sha> && npm run build && npm run start`.

## After code that touches E2B

```bash
npm run e2b:build:prod
# ensure E2B_TEMPLATE_ID secret matches alias/id
```

## CI

Push to `main` runs typecheck/tests via GitHub Actions (see `.github/workflows/ci.yml`).
