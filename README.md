# The Great Date Glitch — backend

Standalone NestJS application (Express adapter), TypeScript and PostgreSQL. The frontend deploys independently; there are no imports or build dependencies outside this project directory.

## Local setup

Use Node.js 22+ and PostgreSQL 17 (or a Neon development database). From this directory:

```sh
npm ci
```

Copy `.env.example` to `.env`, set `DATABASE_URL` to an existing database, and set `FRONTEND_ORIGIN=http://localhost:3000`. Then:

```sh
npm run build
npm run migrate
npm run dev
```

The server listens on `0.0.0.0`, using `PORT` (default 3001). `GET /api/v1/health` checks the database. `npm start` runs the production build. See the frontend README for its separate setup.

## Neon and Render

Create a Neon project/database. Copy its PostgreSQL connection URL from the Connect panel into Render's secret `DATABASE_URL`; retain TLS parameters. The application uses the `pg` connection pool, not local files. Do not put this URL in frontend environment variables. Neon provides standard [PostgreSQL connection URIs](https://api-docs.neon.tech/reference/getconnectionuri).

Create a Render **Web Service** from this repository using these settings:

| Setting | Value |
| --- | --- |
| Root directory | `tgdg_backend` (blank if this directory is its own repository) |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm run migrate && npm start` |
| Health check | `/api/v1/health` |
| Environment | `NODE_ENV=production`, `DATABASE_URL`, `FRONTEND_ORIGIN` |

Set `FRONTEND_ORIGIN` to the exact Netlify origin, e.g. `https://your-date.netlify.app`, without a trailing slash. Multiple explicitly trusted origins can be comma-separated. Development automatically includes localhost ports 3000 and 5173; production does not. For local phones, explicitly add the frontend LAN origin. CORS allows GET/POST/OPTIONS and Authorization/Content-Type; no wildcard origins. See Render's [service settings](https://render.com/docs/web-services) and [root-directory behavior](https://render.com/docs/monorepo-support).

Migrations run before the service starts, including on free services. They use a transaction, an advisory lock and a migration ledger so concurrent starts cannot apply them twice. SQL files remain in `migrations/` alongside `dist/` on deployment. No Render disk is needed. Accounts, credentials, actual Netlify origin and production deployment remain owner setup steps; this project has not been deployed by this task.

## API and persistence

All endpoints are under `/api/v1`: `GET /health`, `POST /sessions`, `POST /sessions/join`, `GET /sessions/:id`, and POST suffixes `/character`, `/start`, `/choices`, `/advance`.

- Creation returns UUID `sessionId`, five-character uppercase `joinCode`, `playerToken`, `playerRole`. Join takes `{joinCode}`. Codes exclude I/O/0/1; a database unique constraint and cryptographic generation protect allocation. Only two players can join.
- Session routes require `Authorization: Bearer <playerToken>`. PostgreSQL stores SHA-256 token hashes, never raw tokens. Keep browser storage private: the token grants that player's seat and cannot be recovered from a join code.
- Character fields match the frontend, including the supported color palettes, body styles, accessories and room themes. Names are 1–18 characters. Setup is locked after starting. Only the host starts, after both setups are complete.
- Choices take `{sceneId, choiceId}`. A locked session row serializes all state changes. The first choice is immutable, exact retries are safe, and the second submission resolves and records the outcome once in the same transaction. Responses explicitly project the caller's view; the other player's choice ID, option descriptions and private thoughts are withheld before reveal.
- Advance takes `{ready:true, phaseId}` using `phaseId` from the current response. Both players must be ready. Scene 5 in each chapter enters a recap with fresh readiness. Both ready on that recap enters the next chapter, or the ending after chapter 3. Stale phase retries are ignored, so duplicate taps cannot skip the recap. This extends the original frontend's `{ready:true}` contract deliberately.
- Responses retain the existing `SessionResponse` fields and add `revision`, `phaseId` and `nextSceneId`. Frontend revision checks reject late older responses. Polls count as activity but do not increment revision.
- One PostgreSQL JSONB aggregate stores characters, setup readiness, current scene, choices, reveal, advancement readiness, fictional variables and log. Row-level locking is intentional for a two-player game and works across server instances. Story schema version 1 and the saved current scene preserve refresh/restart behavior. Future incompatible story changes need a version migration or retention of the old resolver.
- Session operations return 400 for invalid input, 401 for invalid tokens, 403 for guest start, 404 for unknown sessions, 409 for conflicting game actions/full or ended rooms, 410 for expiry, and 413 for bodies exceeding 16 KB.

Sessions expire after six hours without an authenticated read or accepted action. Expired requests cannot revive them. Schedule `npm run cleanup` hourly using a scheduler with `DATABASE_URL` (for example a separate Render Cron Job with this same root/build). It deletes only rows older than six hours, including their embedded tokens and logs. Without scheduling, data remains stored but inaccessible until cleanup runs. A cleaned-up code returns not found rather than expired. Keep database credentials restricted to the backend and scheduler.

## Story and verification

`src/story.ts` owns 15 encountered scenes, 15 paired decisions and 60 individually written pair outcomes. All paths pass through three chapters; local consequences reconnect while retaining fictional state. The dinner buffer is story state, not a real-time countdown or a relationship score. Laptop damage remains through the ending, preparation affects spills and travel, courtesy affects assistance, and three accumulated-state endings resolve differently.

Set `TEST_DATABASE_URL` to a **disposable PostgreSQL database**, then run `npm test`. Tests apply migrations, allocate isolated sessions, run HTTP clients against real NestJS listeners and delete their own session rows afterward. They cover setup/authentication, concurrent joining, CORS, size/input validation, expiry, private views, role validation, retries, simultaneous submissions, server restart recovery, all pair resolutions, recaps, persistent damage, later callbacks and three full playthroughs. `test/playthrough-report.json` records the executed routes and consequences.

Verified locally against PostgreSQL 17: backend and frontend production builds; three independent-token HTTP playthroughs, each with all 15 scenes and all three recaps:

| Route | Ending | Observed consequence |
| --- | --- | --- |
| Courteous and prepared | Diplomatic Rescue | Early courtesy earns Henderson's towel, table and shortbread; laptop stays dry. |
| Rushed and improvised | Beautiful Chaos | Missing spill kit causes lasting laptop damage; Henderson withholds supplies. |
| Quiet and independent | Accidental Soulmates | Work boundaries preserve time; laptop survives; finale works without neighbor assistance. |

Scenes: The Buzzer Has a Solo; The Napkin Treaty; A Bag with Two Names; Table for One Phone; The First Actual Bite; Sauce at the Hinge; You Are Now a Panelist; A Knock with Equipment; The Chair Has a Name Tag; The Evening Needs a Handle; Cannoli, Structurally Speaking; Henderson at the Threshold; Three Flights, One Signal Bar; The Photograph Nobody Planned; Midnight, with Receipts.

Each route encountered about 4,400 words across shared dialogue, both sets of options, outcomes and ending. Estimated duration is **25–35 minutes** at 180–220 words/minute plus 5–10 minutes for decisions and pauses. This is an estimate, not a timed human playtest; rereading the recaps or discussing every choice may take longer. Automated clients verify behavior, not mobile rendering or subjective pacing.

## Two-device acceptance check

1. Deploy both projects, configure their origins, and open the Netlify URL on two devices or separate browser profiles. Keep your regular voice/video call separate from the game.
2. Host customizes and creates; guest uses the five-character code or invite link and completes setup. Both appearances should update in the lobby. A third join should fail.
3. Start as host. Read the scene on both devices; submit only on one. The other player must still be able to read and decide, with no partner choice in their network response.
4. Submit the second choice, refresh both browsers, and confirm the same shared outcome and story log. Mark ready on only one and verify the other remains at the outcome.
5. Finish scene 5; both must separately acknowledge the chapter recap. Repeat through chapter 3 and the ending. Restart the backend mid-game and confirm recovery by polling.
6. Replay using different actions (especially scene 1.4 spill setup and scene 2.1 rescue), observe the lasting laptop consequence and a different ending. Test a temporary connection loss and automatic reconnect.
