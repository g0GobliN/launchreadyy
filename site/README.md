# LaunchReadyy public site

This directory is the standalone public informational website. It is a static React/Vite app and
does not import or deploy the root Community server, worker, scheduler, credentials, or SQLite data.

```bash
npm install
npm run dev
npm run build
```

For Vercel, set the project root directory to `site`, the build command to `npm run build`, and the
output directory to `dist`.
