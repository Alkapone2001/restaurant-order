# Restaurant Orders

A restaurant ordering app with waiter order-taking, kitchen status control, payment closing, daily reporting, role-based login, menu administration, staff management, and audit history.

The app now stores data in Postgres, not JSON files. The backend is split so it can run locally with `server.js` and on Vercel through `api/index.js`.

## Requirements

- Node.js 18+
- A Postgres database
- `DATABASE_URL` environment variable

## Run Locally

```bash
npm install
set DATABASE_URL=postgres://user:password@host:5432/database
npm start
```

Open:

```text
http://localhost:3000
```

On PowerShell you can set the variable with:

```powershell
$env:DATABASE_URL="postgres://user:password@host:5432/database"
npm start
```

## Vercel Deploy

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add a Postgres database, for example Vercel Postgres, Neon, Supabase, or Railway.
4. Set `DATABASE_URL` in Vercel project environment variables.
5. Deploy.

The first request will create the database tables and seed the default users/products.

## Separate Restaurant Deployment

Use this setup when one GitHub repo serves multiple restaurants:

- The existing Vercel project stays connected to `main`/`master` and keeps its current database.
- The new restaurant gets a different Vercel project connected to the `lidhja` branch.
- The new Vercel project must use a different Postgres database.
- Changes on `lidhja` will not affect the existing deployment unless they are merged into `main`/`master`.

Do not reuse the existing `.vercel/project.json` project link for the `lidhja` deployment.

```powershell
# From this repository folder, remove the local link to the old Vercel project.
Remove-Item -Recurse -Force .vercel

# Install the Vercel CLI if needed, then create/link a new project.
npm i -g vercel
vercel login
vercel link
```

When `vercel link` asks whether to link to an existing project, choose `N` and give the new project a different name, for example `restaurant-order-lidhja`.

If using the Vercel dashboard instead of the CLI, import the same GitHub repository as a new Vercel project and set the new project's Production Branch to `lidhja`. Leave the existing Vercel project pointed at `main`/`master`.

Create a new database for the new restaurant, then set these environment variables on the new Vercel project only:

```bash
DATABASE_URL=postgres://user:password@host:5432/new_restaurant_database
RESTAURANT_NAME=New Restaurant Name
PGSSL=true
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

Then deploy only to the new Vercel project:

```powershell
vercel --prod
```

The old deployment remains unaffected as long as it keeps its original Vercel project and database environment variables. This app creates tables and seeds the restaurant name only in the database connected to the project receiving the request.

## Migrate Existing JSON Data

If you already have data in `data/store.json`, set `DATABASE_URL` and run:

```bash
npm run migrate:json
```

You can also pass a custom JSON file:

```bash
node scripts/migrate-json-to-postgres.js ./data/store.json
```

## Default Users

Change these immediately before real use.

| Role | Username | Password |
| --- | --- | --- |
| Admin/manager | `albert` | `shefi123` |
| Kitchen | `kitchen` | `kitchen123` |

## Main Workflows

- Waiter creates a table order and sends it to the kitchen.
- Every product routes to the kitchen dashboard.
- Kitchen confirms, prepares, and marks the order done.
- Waiter closes done orders as paid with payment method, discount, and tip.
- Admin views daily reports, voids, payment-method totals, and waiter totals.
- Admin manages products in the Menu tab.
- Admin creates, edits, activates, and removes waiters in the Staff tab.
- Important actions are stored in the audit log.

## Environment Variables

```bash
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_URL_UNPOOLED=postgres://user:password@host:5432/database
POSTGRES_URL=postgres://user:password@host:5432/database
POSTGRES_URL_NON_POOLING=postgres://user:password@host:5432/database
POSTGRES_PRISMA_URL=postgres://user:password@host:5432/database
RESTAURANT_NAME=Restaurant Orders
PGSSL=true
PORT=3000
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

The app accepts `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL_NO_SSL`. Prefer the pooled `DATABASE_URL`/`POSTGRES_URL` on Vercel. Set `PGSSL=false` only for local Postgres instances that do not use SSL.

`RESTAURANT_NAME` is used when a fresh database is seeded and on the public login screen. Existing databases keep the name already stored in the `settings` table.

`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are required for background push notifications. Set them in Vercel environment variables, not in committed files.
