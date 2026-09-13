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

## DigitalOcean Droplet Deployment

The production app should run behind Nginx and be supervised by systemd. Do not
keep it alive with an SSH terminal or `npm start`; that process stops when the
terminal closes and does not reliably recover after a crash or reboot.

The checked-in examples assume the repository is at `/opt/restaurant-order`
and runs as a dedicated `restaurant-order` Linux user.

```bash
sudo useradd --system --home /opt/restaurant-order --shell /usr/sbin/nologin restaurant-order || true
sudo mkdir -p /opt/restaurant-order
sudo chown -R restaurant-order:restaurant-order /opt/restaurant-order
```

Clone or pull the repository into that directory, then install production
dependencies:

```bash
cd /opt/restaurant-order
sudo -u restaurant-order npm ci --omit=dev
```

Create `/etc/restaurant-order.env` (never commit this file):

```text
DATABASE_URL=postgres://user:password@host:5432/database
PGSSL=true
HOST=127.0.0.1
PORT=3000
DB_POOL_MAX=10
DB_CONNECT_TIMEOUT_MS=5000
DB_IDLE_TIMEOUT_MS=30000
```

Install and enable the service:

```bash
sudo cp deploy/restaurant-order.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now restaurant-order
sudo systemctl status restaurant-order --no-pager
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

Edit `YOUR_DOMAIN_OR_DROPLET_IP` in `deploy/nginx.conf`, then install it:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/restaurant-order
sudo ln -sfn /etc/nginx/sites-available/restaurant-order /etc/nginx/sites-enabled/restaurant-order
sudo nginx -t
sudo systemctl reload nginx
```

For future releases:

```bash
cd /opt/restaurant-order
sudo -u restaurant-order git pull --ff-only
sudo -u restaurant-order npm ci --omit=dev
sudo systemctl restart restaurant-order
curl --fail http://127.0.0.1:3000/api/ready
```

Useful diagnostics:

```bash
sudo systemctl status restaurant-order --no-pager
sudo journalctl -u restaurant-order -n 200 --no-pager
sudo nginx -t
df -h
free -h
```

## Vercel Deploy

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add a Postgres database, for example Vercel Postgres, Neon, Supabase, or Railway.
4. Set `DATABASE_URL` in Vercel project environment variables.
5. Deploy.

The first request will create the database tables and seed the default users/products.

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
| Admin/manager | `valon` | `palma5valon` |
| Kitchen | `kitchen` | `kitchen123` |
| Bartender | `bartender` | `bar123` |
| Pizzaman | `pizzaman` | `pizza123` |

## Main Workflows

- Waiter creates a table order and sends it to the correct preparation stations.
- Products are assigned to fixed menu categories. Pizza routes to the pizzaman dashboard, drinks and coctails route to the bartender dashboard, and all other food categories route to the kitchen dashboard.
- Kitchen, bartender, and pizzaman each confirm, prepare, and mark their assigned items done.
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
PGSSL=true
PORT=3000
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

The app accepts `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL_NO_SSL`. Prefer the pooled `DATABASE_URL`/`POSTGRES_URL` on Vercel. Set `PGSSL=false` only for local Postgres instances that do not use SSL.

`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are required for background push notifications. Set them in Vercel environment variables, not in committed files.
