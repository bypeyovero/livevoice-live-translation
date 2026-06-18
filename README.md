# LiveVoice — Real-Time Broadcast Translation

Powered by **Gemini 3.5 Live Translate API**

> Speak once. Everyone listens in their own language.

---

## What This App Does

- **Speaker** starts a session, speaks in their language (Mandarin, English, Khmer, Indonesian, Japanese, Spanish)
- **Attendees** open the shared link or scan the QR code, choose their language, and hear the translation live
- Supports: 🇨🇳 Mandarin · 🇬🇧 English · 🇰🇭 Khmer · 🇮🇩 Indonesian · 🇯🇵 Japanese · 🇪🇸 Spanish · 🇫🇷 French · 🇩🇪 German · 🇰🇷 Korean · 🇻🇳 Vietnamese · 🇹🇭 Thai

---

## Tech Stack

- **React 19 + TypeScript + Vite** (frontend)
- **Express + Node.js** (backend server)
- **WebSocket (ws)** for real-time audio streaming
- **Gemini 3.5 Live Translate API** for real-time translation
- **Tailwind CSS + Framer Motion** for UI
- **Firebase** for room management

---

## Deploy to Railway (Recommended — Free, Supports WebSocket)

Railway is the best platform for this app because it supports persistent WebSocket connections, which are required for real-time audio streaming.

### Step 1 — Create a Railway account
1. Go to [railway.com](https://railway.com) and sign up (free)
2. Connect your GitHub account when prompted

### Step 2 — Create a new project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose **`bypeyovero/livevoice-live-translation`**
4. Railway will auto-detect the Node.js app and start deploying

### Step 3 — Set environment variables
In your Railway project dashboard, go to **Variables** tab and add:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `NODE_ENV` | `production` |

### Step 4 — Get your public URL
1. Go to **Settings → Networking → Generate Domain**
2. Railway gives you a free URL like `livevoice-production.up.railway.app`
3. Share this URL with your attendees!

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/bypeyovero/livevoice-live-translation.git
cd livevoice-live-translation

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start development server
npm run dev
# Open http://localhost:3000
```

---

## How to Use

### As Speaker
1. Open the app URL
2. Click **"Start as Speaker"**
3. Enter your room code or use the auto-generated one
4. Select your speaking language
5. Share the link or QR code with your audience
6. Click **"Launch Live Broadcast Room"** to start

### As Attendee
1. Open the shared link (or scan QR code)
2. Enter the room code if prompted
3. Choose your preferred listening language
4. Live translation will appear automatically

---

## Getting Your Gemini API Key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **"Create API key"**
3. Copy the key (starts with `AIza...`)
4. Add it to Railway environment variables (not in the app UI)

---

## Supported Languages

| Language | Code |
|---|---|
| Mandarin Chinese | `zh` |
| English | `en` |
| Khmer (Cambodian) | `km` |
| Indonesian | `id` |
| Japanese | `ja` |
| Spanish | `es` |
| French | `fr` |
| German | `de` |
| Korean | `ko` |
| Vietnamese | `vi` |
| Thai | `th` |

---

## Important Notes

- Works best with **headphones** to prevent audio feedback
- Keep the browser tab open during the session
- For China users: requires VPN to access Google services
- The API key is stored securely on the server — attendees never see it

---

*Built by [@bypeyovero](https://github.com/bypeyovero) — LiveVoice Live Translation Tool*
