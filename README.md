# HeatRun Fitness Map

A self-contained fitness heatmap app with GPS run tracking, Strava import, route analytics, and installable phone app support.

## What is included

- Activity heatmap rendered on canvas
- GPS run tracking with live distance, time, pace, location, and accuracy
- Route selection, sport filtering, and route search
- Analytics dashboard with weekly load and sport mix
- Strava OAuth connection and activity import
- Settings for Strava import and device permissions
- JSON export and local browser storage
- Installable PWA setup with manifest, app icons, and offline cache

## Run it

Open `index.html` in a browser. No package install is required.

For local GPS and PWA testing, serve the folder on localhost:

```bash
node dev-server.js 4173
```

Then open `http://localhost:4173`.

## Use it on your phone

For phone installation, the app must be served from `https://` or `localhost`; opening `index.html` directly as a file will not install as an app.

The easiest path is to upload this folder to Netlify, Vercel, or GitHub Pages. Then open the live URL on your phone and choose:

- Android Chrome: menu > Add to Home screen or Install app
- iPhone Safari: Share > Add to Home Screen

After that it launches like a normal app and keeps working offline after the first load.

## Track real runs

Open the app on your phone from an `https://` URL, go to `Track`, and tap `Start run`. Allow location access when the browser asks. The app records GPS points locally, shows live stats, and saves completed runs into the heatmap and route library.

Phone browsers can pause location updates when the screen locks or the app is fully backgrounded. For best tracking, install the app to your home screen and keep it open while running.

## Sync Strava

1. Create a Strava API app at `https://www.strava.com/settings/api`.
2. Set the Strava callback domain to the domain where this app is hosted, for example `yourusername.github.io`.
3. Upload this app to GitHub Pages and open the live `https://` URL.
4. Go to `Setup`.
5. Copy the redirect URL shown in the app and make sure your Strava app allows that domain.
6. Paste your Strava client ID and client secret into the app.
7. Tap `Save settings`, then `Connect Strava`.
8. Approve access on Strava.
9. Back in HeatRun, tap `Finish connection`, then `Sync activities`.

The client secret is stored only in your browser local storage. Do not hardcode it into the files you upload to GitHub.

## Production path

To turn this into the full Android app from the chat, use this prototype as the UI and data model reference, then port the screens to Flutter with:

- `mapbox_maps_flutter` for the native map and heatmap layer
- `firebase_auth` and `cloud_firestore` for accounts and activity storage
- Strava OAuth for importing real activities
- Android permissions for location, background location, and Health Connect
