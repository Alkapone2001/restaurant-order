# Restaurant Orders

A production-oriented local restaurant ordering app with waiter order-taking, kitchen status control, payment closing, daily cash reporting, role-based login, menu administration, and audit history.

## Run locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Default users

Change these before real use.

| Role | Username | Password |
| --- | --- | --- |
| Admin/manager | `admin` | `admin123` |
| Kitchen | `kitchen` | `kitchen123` |
| Waiter | `arta` | `waiter123` |
| Waiter | `jon` | `waiter123` |

## Main workflows

- Waiter logs in, creates a table order, adds menu items and kitchen notes, then sends it to the kitchen.
- Kitchen logs in, confirms the order, moves it to preparing, then marks it done.
- Waiter sees the status update, accepts payment, applies discount/tip/payment method, and closes the order as paid.
- Admin views daily sales, payment-method totals, waiter totals, voids, tips, discounts, and can close the day.
- Admin can add/edit menu items, update prices, and hide unavailable products.
- Every important action is recorded in the audit log.

## Data and backups

Data is stored in:

```text
data/store.json
```

The server writes the file atomically and creates periodic backups in:

```text
data/backups/
```

For real deployment, back up this directory automatically and test restore procedures.

## Production notes

This app is much stronger than the first prototype, but a real restaurant deployment still needs the right environment:

- Run behind HTTPS with a real domain or private restaurant network.
- Replace default passwords immediately.
- Use a process manager such as PM2, Windows Service, Docker, or a managed host so the server restarts after crashes/reboots.
- Use a managed database if multiple branches, heavy traffic, long-term reporting, or compliance requirements matter.
- Put automatic backups on a separate machine/cloud location.
- Test with the restaurant staff before opening service.

## Environment variables

```bash
PORT=3000
DATA_FILE=./data/store.json
```

`DATA_FILE` is useful for staging or testing without touching production data.
