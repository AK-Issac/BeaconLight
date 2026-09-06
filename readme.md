# 🔦 SpotLight

**See what websites are doing with your data. Stop them with one click.**  
*Built for MuslimHacks 2026 — Online Privacy Track*

![SpotLight Banner](https://via.placeholder.com/1200x300?text=SpotLight+-+Application-Level+Privacy+Inspector)

## 📖 Overview

Most privacy tools fall into two extremes: they are either silent domain blocklists (like uBlock) that don't explain *why* things are blocked, or highly technical inspector tools (like Wireshark) built only for network engineers. 

**SpotLight** closes this gap. It is a Chrome Extension that sits in your browser's Side Panel, intercepts outgoing network traffic in real-time, and explains exactly what data is being stolen in plain English. With our **Two-Tier classification system**, known trackers are blocked automatically, while sneaky behavioral tracking (like device fingerprinting or extension probing) is flagged for you to manually block or **spoof** with fake data.

### 🛑 The Problem: The "BrowserGate" Threat
Recent cases like the LinkedIn "BrowserGate" incident revealed that websites actively probe user browsers to detect installed extensions (such as Islamic apps like Deen Shield or PordaAI). This silent probing can reveal highly sensitive personal traits, including religion. Ordinary users currently have zero visibility into this data theft and no tools to send back fake data.

## ✨ Key Features

- **📊 Two-Tier Trust System:** 
  - **Tier 1 (Auto-Block):** Known analytics and advertising trackers are blocked by default using native `DeclarativeNetRequest` rules.
  - **Tier 2 (Notify & Act):** Behavioral heuristics (location requests, fingerprinting, extension probing) are flagged in the UI for user review.
- **🎭 Smart Spoofing (Don't Break The Web):** Instead of just blocking requests (which can crash map widgets or video players), SpotLight can inject *syntactically valid fake data* (e.g., a randomized geolocation in the ocean, or a fake Canvas fingerprint) to keep the site functioning while protecting your identity.
- **🖥️ Persistent Side Panel:** Monitor data flows in real-time right next to the web page you are browsing. Groups requests cleanly by destination domain to prevent UI clutter.
- **🎚️ Master Toggle:** A simple On/Off switch that completely pauses the extension to save CPU/memory when you are just doing basic browsing.
- **🔒 100% Local Processing:** No external AI APIs, no cloud servers. Your request data never leaves your machine. 

## 🛠️ Tech Stack

- **Framework:** React.js + TypeScript
- **Build Tool:** Vite + `@crxjs/vite-plugin`
- **Architecture:** Chrome Extension Manifest V3
- **APIs Used:** `chrome.sidePanel` (Chrome/Edge/Brave), toolbar popup + `sidebar_action` (Opera GX / Firefox), `declarativeNetRequest`, `webRequest`, `chrome.storage`

## 🚀 Installation (Developer Mode)

SpotLight is a Manifest V3 WebExtension. Chrome, Edge, and Brave use the **side panel**. Opera GX and Firefox use the **toolbar popup** (and Firefox/Opera can also pin the **sidebar**).

1. **Install and build:**
   ```bash
   npm install
   npm run build
   ```

   For live reload while hacking on Chromium browsers:
   ```bash
   npm run dev
   ```

2. **Load the extension** in your browser (pick one):

   **Chrome / Edge / Brave**
   - Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`)
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `dist` folder

   **Opera GX / Opera**
   - Open `opera://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `dist` folder
   - Click the SpotLight toolbar icon to open the popup

   **Firefox** (Firefox 121+)
   ```bash
   npm run build:firefox
   ```
   - Open `about:debugging#/runtime/this-firefox`
   - Click **Load Temporary Add-on…**
   - Select `dist-firefox/manifest.json` (the file, not the folder)
   - Optionally open the sidebar: **View → Sidebar → SpotLight**

   **Safari** is not a drop-in load. Apple requires wrapping this as a Safari Web Extension in Xcode (`xcrun safari-web-extension-converter dist`). Tracking observation and spoofing can work; network blocking is limited on Safari.

3. Click the SpotLight icon. Browse any site (or open `test-page.html`) and requests will appear in the panel/popup.