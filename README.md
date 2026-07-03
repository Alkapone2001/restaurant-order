# Porosite e Restorantit

Aplikacion per porosi restoranti me kamarier, kuzhine, pagesa, raport ditor, hyrje sipas rolit, menaxhim menuje, menaxhim stafi dhe historik veprimesh.

Te dhenat ruhen ne Postgres. Backend-i punon lokalisht me `server.js` dhe ne Vercel permes `api/index.js`.

## Kerkesat

- Node.js 18+
- Database Postgres
- Variabla `DATABASE_URL`

## Nisja Lokale

```bash
npm install
set DATABASE_URL=postgres://user:password@host:5432/database
npm start
```

Hape:

```text
http://localhost:3000
```

Ne PowerShell:

```powershell
$env:DATABASE_URL="postgres://user:password@host:5432/database"
npm start
```

## Deploy Ne Vercel

1. Shtyje repo-n ne GitHub.
2. Importoje ne Vercel.
3. Shto nje database Postgres, p.sh. Prisma Postgres, Neon, Supabase ose Railway.
4. Vendos `DATABASE_URL` ne variablat e projektit ne Vercel.
5. Bej deploy.

Kerkesa e pare krijon tabelat dhe perdoruesit fillestare.

## Deploy I Ndare Per Lidhja

Ky konfigurim perdoret kur nje repo sherben disa restorante:

- Projekti ekzistues ne Vercel rri i lidhur me `main`/`master` dhe databazen e vet.
- Restoranti i ri ka projekt tjeter ne Vercel te lidhur me branch-in `lidhja`.
- Projekti i ri ne Vercel perdor database tjeter Postgres.
- Ndryshimet ne `lidhja` nuk prekin deploy-in ekzistues pa u bashkuar ne `main`/`master`.

Mos e riperdor lidhjen ekzistuese `.vercel/project.json` per deploy-in e `lidhja`.

```powershell
Remove-Item -Recurse -Force .vercel
npm i -g vercel
vercel login
vercel link
```

Kur `vercel link` pyet nese do te lidhesh me projekt ekzistues, zgjidh `N` dhe vendos emer tjeter, p.sh. `restaurant-order-lidhja`.

Nese perdor dashboard-in e Vercel, importo te njejtin repo si projekt te ri dhe vendos Production Branch ne `lidhja`. Projekti ekzistues le te qendroje ne `main`/`master`.

Krijo database te re per restorantin e ri dhe vendos keto variabla vetem ne projektin e ri:

```bash
DATABASE_URL=postgres://user:password@host:5432/new_restaurant_database
RESTAURANT_NAME=Emri i Restorantit
PGSSL=true
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

Deploy vetem ne projektin e ri:

```powershell
vercel --prod
```

Deploy-i i vjeter mbetet i paprekur per sa kohe ruan projektin dhe variablat e veta ne Vercel.

## Migrimi Nga JSON

Nese ke te dhena ne `data/store.json`, vendos `DATABASE_URL` dhe ekzekuto:

```bash
npm run migrate:json
```

Ose perdor nje file tjeter JSON:

```bash
node scripts/migrate-json-to-postgres.js ./data/store.json
```

## Perdoruesit Fillestare

Ndryshoji menjehere para perdorimit real.

| Roli | Perdoruesi | Fjalekalimi |
| --- | --- | --- |
| Admin/menaxher | `albert` | `shefi123` |
| Kuzhina | `kitchen` | `kitchen123` |

## Rrjedha Kryesore

- Kamarieri krijon porosi tavoline dhe e dergon ne kuzhine.
- Cdo produkt shkon ne ekranin e kuzhines.
- Kuzhina e pranon, e pergatit dhe e shenon porosine gati.
- Kamarieri mbyll porosite gati si te paguara me metode pagese, zbritje dhe bakshish.
- Admini sheh raportet ditore, anulimet, totalet sipas pageses dhe totalet sipas kamarierit.
- Admini menaxhon produktet ne tab-in Menuja.
- Admini krijon, ndryshon, aktivizon dhe heq kamarieret ne tab-in Stafi.
- Veprimet e rendesishme ruhen ne historik.

## Variablat E Ambientit

```bash
DATABASE_URL=postgres://user:password@host:5432/database
DATABASE_URL_UNPOOLED=postgres://user:password@host:5432/database
POSTGRES_URL=postgres://user:password@host:5432/database
POSTGRES_URL_NON_POOLING=postgres://user:password@host:5432/database
POSTGRES_PRISMA_URL=postgres://user:password@host:5432/database
RESTAURANT_NAME=Porosite e Restorantit
PGSSL=true
PORT=3000
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
```

Aplikacioni pranon `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, ose `POSTGRES_URL_NO_SSL`. Ne Vercel prefero `DATABASE_URL`/`POSTGRES_URL`. Vendos `PGSSL=false` vetem per Postgres lokal pa SSL.

`RESTAURANT_NAME` perdoret kur krijohet database e fresket dhe ne ekranin publik te hyrjes. Databazat ekzistuese mbajne emrin e ruajtur ne tabelen `settings`.

`VAPID_PUBLIC_KEY` dhe `VAPID_PRIVATE_KEY` duhen per njoftime ne sfond. Vendosi ne variablat e Vercel, jo ne file te commit-uara.
