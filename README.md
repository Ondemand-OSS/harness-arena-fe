# Agentic Harness Arena Frontend

The web interface for [Agentic Harness Arena](https://www.harness-arena.ai), a blind evaluation platform for AI agent harnesses.

It lets users browse tasks, run evaluations, review anonymized outputs, and view leaderboard results.

## Stack

- React
- Vite
- Tailwind CSS

## Run locally

Requirements: Node.js 18+ and access to a compatible Arena API.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Configuration

Set `VITE_API_BASE` to the public URL of the API when building for a non-local environment:

```bash
VITE_API_BASE=https://api.example.com npm run build
```

For local development, leave it unset when using the development proxy.

## Production build

```bash
npm run build
npm run preview
```

The generated static files are written to `dist/` and can be served by any static hosting provider with SPA route fallback enabled.

## Related project

The API and evaluation service live in the [Agentic Harness Arena backend](https://github.com/Ondemand-OSS/harness-arena) repository.

## License

MIT
