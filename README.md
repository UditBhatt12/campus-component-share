# ⚡ IITR Campus Component Share

A peer-to-peer hardware and electronic component sharing platform built for the **IIT Roorkee** campus community. Students can list spare electronic components (microcontrollers, sensors, ICs, tools), browse available inventory across hostels and departments, request components for lab projects or hackathons, and track checkouts and returns seamlessly.

---

## 🌐 Live Deployments

* **Primary Production (Vercel):** [https://campus-component-share.vercel.app/](https://campus-component-share.vercel.app/)
* **Secondary Mirror (Render):** [https://campus-component-share.onrender.com](https://campus-component-share.onrender.com)

*(Note: Both deployments are connected to the same live MongoDB Atlas cluster in real time. Render's free tier may take ~30 seconds to wake up on the first request after inactivity, whereas Vercel loads instantaneously.)*

---

## ✨ Key Features

* **IIT Roorkee Email Verification:** Restricted sign-up and authentication for verified `@iitr.ac.in` and `@*.iitr.ac.in` campus email addresses.
* **Component Inventory Feed:** Search and filter available hardware components by category, condition, availability, and owner.
* **Peer-to-Peer Requests:** Post urgent requests for missing components needed for coursework, Tinkerers' Lab projects, or competitions.
* **Checkout & Return Tracking:** Manage lending states, borrower approvals, and return confirmations between juniors and seniors.
* **Real-Time Notifications & Campus Stats:** Track active listings, fulfilled requests, and user notifications.
* **Dual-Storage Resilience:** Powered by **MongoDB Atlas** (`mongoose`) in production with automatic local JSON fallback (`data/campus-db.json`) for offline local development.

---

## 🛠️ Tech Stack

* **Frontend:** Vanilla JavaScript (SPA Hash Router), HTML5, Modern CSS3
* **Backend:** Node.js, Express.js (`server.js`)
* **Database:** MongoDB Atlas & Mongoose ODM (`db.js`, `models/schemas.js`)
* **Security & Auth:** JWT (`jsonwebtoken`), Password Hashing (`bcryptjs`), Rate Limiting (`express-rate-limit`), HTTP Headers (`helmet`), CORS
* **Deployment:** Vercel (Serverless + CDN) & Render (Continuous Web Service)

---

## 📂 Project Structure

```text
campus-component-share/
├── data/
│   └── campus-db.json       # Local fallback / seed data
├── middleware/
│   └── auth.js              # JWT authentication middleware
├── models/
│   └── schemas.js           # Mongoose schemas (User, Inventory, Request, Checkout, Notification)
├── public/
│   ├── css/style.css        # Application styling
│   ├── js/app.js            # Frontend SPA logic & API client
│   └── index.html           # Entry HTML shell
├── routes/
│   ├── auth.js              # Register, login, profile endpoints
│   ├── inventory.js         # Component CRUD endpoints
│   ├── requests.js          # Component request endpoints
│   ├── checkouts.js         # Lending & return lifecycle endpoints
│   ├── notifications.js     # User notification endpoints
│   └── stats.js             # Platform-wide statistics
├── scripts/
│   └── seed.js              # Database seeding script
├── tests/
│   └── smoke.js             # Automated smoke tests
├── utils/
│   ├── crypto-auth.js       # Password hashing & token utilities
│   ├── mini-app.js          # Express app helpers
│   └── validate.js          # Input sanitization & IITR email validation
├── config.js                # Environment & app configuration
├── db.js                    # MongoDB Atlas connection & fallback manager
├── server.js                # Main Express server entry point
├── vercel.json              # Vercel serverless routing configuration
└── package.json             # Dependencies & npm scripts
```

---

## 🚀 Running Locally

### 1. Clone the Repository
```bash
git clone https://github.com/UditBhatt12/campus-component-share.git
cd campus-component-share
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory (you can copy `.env.example`):
```bash
cp .env.example .env
```
Update `.env` with your credentials:
```env
PORT=3000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/campus_component_share?retryWrites=true&w=majority
JWT_SECRET=your_super_secret_jwt_key
NODE_ENV=development
```

### 4. Start the Server
```bash
npm start
```
The application will be live at **`http://localhost:3000`**.

### 5. Run Tests (Optional)
```bash
npm test
```

---

## 🔌 API Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register a new IITR student account |
| `POST` | `/api/auth/login` | Authenticate and receive a JWT |
| `GET` | `/api/inventory` | List all available components |
| `POST` | `/api/inventory` | Add a new component to share |
| `GET` | `/api/requests` | View open component requests |
| `POST` | `/api/requests` | Create a new component request |
| `GET` | `/api/checkouts` | List active and past component checkouts |
| `POST` | `/api/checkouts` | Initiate or update a component checkout |
| `GET` | `/api/notifications` | Fetch user notifications |
| `GET` | `/api/stats` | Get platform summary metrics |

---

## ☁️ Deployment Notes

* **Vercel:** Configured via `vercel.json` and exports the Express app in `server.js`. Automatically deploys on every `git push` to the `main` branch.
* **Render:** Configured as a Node Web Service (`Build Command: npm install`, `Start Command: node server.js`). Automatically deploys on every `git push` to the `main` branch.