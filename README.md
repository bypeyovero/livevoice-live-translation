# LiveVoice — Real-Time Broadcast Translation

Powered by **Gemini 3.5 Live Translate API**

> Speak once. Everyone listens in their own language.

---

## What This App Does

- **Speaker** starts a session, speaks in their language (Mandarin, English, Khmer, Indonesian)
- **Attendees** open the shared link or scan the QR code, choose their language, and hear the translation live
- Supports: 🇨🇳 Mandarin · 🇬🇧 English · 🇰🇭 Khmer · 🇮🇩 Indonesian · 🇯🇵 Japanese

---

## How to Deploy to Netlify (5 minutes)

### Option A — Drag & Drop (Easiest)
1. Go to [netlify.com](https://netlify.com) and log in
2. Click **"Add new site" → "Deploy manually"**
3. Drag the entire `live-translate-app` folder into the deploy area
4. Done — you get a public URL like `https://yoursite.netlify.app`

### Option B — Via GitHub
1. Push this folder to a GitHub repository
2. In Netlify: **"Add new site" → "Import from Git"**
3. Connect your GitHub repo
4. Build settings: leave blank (no build command needed)
5. Publish directory: `.` (root)
6. Deploy

---

## How to Use

### As Speaker
1. Open the app URL
2. Click **"Start as Speaker"**
3. Enter your Gemini API Key when prompted (first time only, stored in browser session)
4. Select your speaking language
5. Share the link or QR code with your audience
6. Tap the microphone button to start broadcasting

### As Attendee
1. Open the shared link (or scan QR code)
2. Choose your preferred listening language
3. Click **"Start Listening"**
4. You will hear the speaker's voice translated in real-time

---

## Getting Your Gemini API Key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **"Create API key"**
3. Copy the key (starts with `AIza...`)
4. Paste it into the app when prompted

**Free tier** is sufficient for business meetings and demos.

---

## Supported Languages

| Language | Code | Input | Output |
|---|---|---|---|
| Mandarin Chinese | `zh` | ✅ | ✅ |
| English | `en` | ✅ | ✅ |
| Khmer (Cambodian) | `km` | ✅ | ✅ |
| Indonesian | `id` | ✅ | ✅ |
| Japanese | `ja` | ✅ | ✅ |

---

## Important Notes

- The **speaker** needs a Gemini API Key (free from Google AI Studio)
- **Attendees** do not need an API key — just open the link
- Works best with **headphones** to prevent audio feedback
- Keep the browser tab open during the session
- For China users: requires VPN to access Google services

---

## Built With

- Gemini 3.5 Live Translate API (WebSocket)
- Vanilla HTML/CSS/JavaScript (no framework)
- QRCode.js for QR generation
- Montserrat font (Google Fonts)

---

*Built for ja-vie.com — Live Translation Tool*
