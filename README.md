# IIT Roorkee — Campus Component Share

A peer-to-peer hardware lending & mentoring portal for **IIT Roorkee** where juniors request hardware components (Arduino boards, STM32s, sensors, Raspberry Pis, logic analyzers) and seniors across Bhawans claim those requests, lend or rent them out, list their idle inventory, and mentor along the way.

**Stack:** Node.js, Express 5, MongoDB Atlas (`mongoose`) with automatic local JSON document store fallback (`data/campus-db.json`), JWT authentication, IIT Roorkee email domain enforcement (`@iitr.ac.in` / `@*.iitr.ac.in`), vanilla JS single-page frontend.

## Quick Start

```bash
npm install
npm run seed    # seeds IIT Roorkee demo users, requests, checkouts, and catalog
npm start       # http://localhost:3000
```

`

**To connect directly to your MongoDB Atlas `Cluster0`:**
1. In your MongoDB Atlas dashboard, click **Connect** on `Cluster0` &rarr; **Drivers**.
2. Copy your exact cluster hostname (it looks like `cluster0.xxxxx.mongodb.net`) and replace `cluster0.n8svkhd.mongodb.net` in `.env` (`MONGO_CLUSTER` and `MONGODB_URI`).
3. Under **Network Access** in MongoDB Atlas, make sure your IP (or `0.0.0.0/0` for development) is allowed.
4. Even if MongoDB Atlas is offline or unreachable, `DB_AUTO_FALLBACK=true` ensures the server starts immediately using `data/campus-db.json` with pre-seeded IIT Roorkee data so the site never crashes.

## Demo Accounts (Password: `demo1234`)

| Role   | Email                   | Bhawan                      |
|--------|-------------------------|-----------------------------|
| Junior | `riya@ece.iitr.ac.in`   | Kasturba Bhawan, B-214      |
| Junior | `aman@cs.iitr.ac.in`    | Cautley Bhawan, G-118       |
| Junior | `junior@iitr.ac.in`     | Govind Bhawan, C-102        |
| Senior | `karan@ece.iitr.ac.in`  | Rajendra Bhawan, F-305      |
| Senior | `neha@ee.iitr.ac.in`    | Sarojini Bhawan, A-410      |
| Senior | `senior@iitr.ac.in`     | Radhakrishnan Bhawan, D-208 |

## Key Features

- **IIT Roorkee Email Restriction**: Only `@iitr.ac.in` and departmental subdomains (`@ece.iitr.ac.in`, `@cs.iitr.ac.in`, `@ee.iitr.ac.in`, etc.) can register.
- **Full Request Lifecycle**: `open` &rarr; `claimed` &rarr; `checked_out` &rarr; `borrower_confirmed` &rarr; `returned` (plus `unclaim` and `cancel`).
- **Senior Available Parts Catalog**: Seniors can list idle components (`/api/inventory`), and juniors can click **Request this part** to auto-fill a borrow request.
- **Technical Q&A Comments**: Built-in discussion thread on every request (`/api/requests/:id/comments`).
- **Activity Notifications & Reputation Karma**: Automatic alerts (`/api/notifications`) and senior karma points on listings, handovers, and returns.

## Automated Tests

```bash
npm test
```
Runs the end-to-end test suite (`tests/smoke.js`) verifying campus email validation, auth, inventory catalog, request lifecycle, handover receipt confirmation, comments, notifications, and public stats.
