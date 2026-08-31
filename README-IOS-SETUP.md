# Pension Ledger — iOS build guide

This is a real Vite + React project wrapped with [Capacitor](https://capacitorjs.com), which
gives you a native iOS app shell you can open directly in Xcode. Everything below runs on
your Mac — nothing here needs the internet except the one-time `npm install`.

## 0. Prerequisites

- **Xcode** (from the Mac App Store) — also installs Command Line Tools
- **CocoaPods**: `sudo gem install cocoapods` (Capacitor's iOS layer uses it)
- **Node.js** 18+ — check with `node -v`
- Your **Apple Developer Program** membership already active ✅

## 1. Install dependencies

```bash
cd pension-ledger-ios
npm install
```

## 2. Build the web app and add the iOS platform

```bash
npm run build          # compiles React + Tailwind into /dist
npx cap add ios        # generates the ios/ Xcode project (one-time)
npx cap sync ios       # copies the web build into the native project
```

After this you'll have an `ios/App/App.xcworkspace` — **always open the `.xcworkspace`,
never the `.xcodeproj`**, or CocoaPods dependencies won't load.

## 3. Set your Bundle ID

Before building, edit `capacitor.config.ts` and change:

```ts
appId: 'com.yourname.pensionledger',
```

to your own reverse-DNS identifier (e.g. `com.johnsmith.pensionledger`). Then re-run:

```bash
npx cap sync ios
```

## 4. App icon

I generated a starter icon at `public/app-icon-1024.png` (1024×1024, no transparency —
Apple requires a flat background, which this already has).

Easiest way to turn it into a full icon set:

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --ios
```

This reads `public/app-icon-1024.png` and fills in every required size in
`ios/App/App/Assets.xcassets/AppIcon.appiconset` automatically. (If you'd rather design
your own icon, just replace `public/app-icon-1024.png` with your own 1024×1024 PNG first.)

## 5. Open in Xcode

```bash
npx cap open ios
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** tab
2. Under **Team**, pick your Apple Developer account
3. Confirm **Bundle Identifier** matches what you set in step 3
4. Under **General**, set your **Display Name** ("Pension Ledger" or whatever you'd like
   the Home Screen label to say) and **Version/Build** numbers

Pick a simulator (or your plugged-in iPhone) from the device dropdown at the top and hit
**▶ Run** to confirm it launches and works before doing anything with App Store Connect.

## 6. Ship to TestFlight

1. In Xcode, select **Any iOS Device (arm64)** as the run target (not a simulator)
2. **Product → Archive** — this takes a few minutes
3. When the Organizer window opens, select the archive → **Distribute App**
4. Choose **App Store Connect → Upload**, keep the default signing options, and finish
   the wizard
5. Go to **[App Store Connect](https://appstoreconnect.apple.com)** → My Apps → (create
   the app record here first if you haven't, using the same Bundle ID) → **TestFlight** tab
6. Your uploaded build appears after Apple finishes processing it (usually 10–30 minutes).
   For **internal testing** (your own team, up to 100 people) it's available almost
   immediately with no review. For **external testing** (anyone else), Apple runs a
   lightweight Beta App Review first — usually under 24–48 hours.
7. Add testers by email (internal) or create a public TestFlight link (external), and
   they'll get an invite through the TestFlight app.

## 7. Later: submitting to the App Store itself

Once you're happy with the TestFlight build, in App Store Connect go to the **App Store**
tab (not TestFlight) → fill in the listing (screenshots, description, privacy details,
support URL) → **Add for Review**, and select the build you already uploaded. This goes
through Apple's full App Review (typically 1–3 days).

## Notes specific to this app

- It's a pure client-side calculator — no backend, no user accounts, no data leaves the
  device. That simplifies Apple's **App Privacy** questionnaire in App Store Connect
  considerably (you can truthfully answer "No" to most data-collection questions).
- The **Accuracy Check** feature's file upload only reads plain `.txt` files locally in
  the browser (`FileReader`) — it never uploads anything anywhere, worth mentioning if
  Apple's review asks about the file-picker permission.
- If you ever want to update the app after editing `src/PensionCalculator.jsx`, the loop
  is just:
  ```bash
  npm run build && npx cap sync ios
  ```
  then re-open/re-run in Xcode.

## Troubleshooting

- **"Multiple commands produce..." or Pod errors in Xcode** → close Xcode, run
  `cd ios/App && pod install`, reopen the `.xcworkspace`.
- **Blank white screen on device** → almost always means `npm run build` wasn't re-run
  before `npx cap sync ios`. Re-run both.
- **"No such module 'Capacitor'"** → you opened `App.xcodeproj` instead of
  `App.xcworkspace`.
