# Contributing to Aircheck

Aircheck accepts bug reports, fixes, scheduler adapters and documentation changes.

## Setup

You need Node 22 or newer. Run npm install, then npm run dev to start the app on http://localhost:3326. Without a config file, the app reads ~/.aircheck/queue. Copy aircheck.config.example.json to aircheck.config.json to point it at your own folders.

## Before a pull request

Before opening a pull request, run npm run typecheck, npm run lint and npm test. CI runs the same three commands on Linux and macOS. If you change src/server code that the MCP server uses, run node scripts/build-mcp-local.mjs and commit the resulting mcp/local-api.mjs.

## Scope

Aircheck reviews what other tools queue. It never posts, holds platform credentials or uploads media. The project will not merge changes that add posting, credential storage or media upload.

## Issues and questions

Open an issue for a bug or proposal. Use Discussions for questions and setup help.

## License

Your contribution uses the license for the directory you change: AGPL-3.0 for the app and Worker, or MIT for mcp/, skills/ and public/schema/.
