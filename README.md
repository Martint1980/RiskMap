# Geschäftsreise Sicherheitskarte

Interaktive Weltkarte mit tagesaktuellen Reisewarnungen des Auswärtigen Amts.
Automatische Updates täglich um **06:00 und 12:00 Uhr UTC**.

## Projektstruktur

```
travel-warning-map/
├── server.js          # Express-Server + Cron-Jobs
├── package.json
├── render.yaml        # Render.com Deployment-Konfig
└── public/
    └── index.html     # Karte (Frontend)
```

## Lokal testen

```bash
npm install
npm start
# → http://localhost:3000
```

## Deployment auf Render.com

### Option A – automatisch via render.yaml

1. Repository auf GitHub pushen
2. https://dashboard.render.com → "New Web Service"
3. Repository verbinden → Render erkennt `render.yaml` automatisch
4. "Deploy" klicken

### Option B – manuell

1. https://dashboard.render.com → "New Web Service"
2. Repository verbinden
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free (ausreichend)
4. Deploy

## Endpunkte

| Endpunkt          | Beschreibung                              |
|-------------------|-------------------------------------------|
| `GET /`           | Weltkarte (index.html)                    |
| `GET /api/warnings` | JSON mit aktuellen Warnstufen (ISO2-Code → Level) |
| `GET /health`     | Status, letztes Update, Länderanzahl      |

## Cron-Zeitplan

| Zeit (UTC) | Uhrzeit Deutschland (Winter) | Uhrzeit Deutschland (Sommer) |
|------------|------------------------------|------------------------------|
| 06:00 UTC  | 07:00 Uhr                    | 08:00 Uhr                    |
| 12:00 UTC  | 13:00 Uhr                    | 14:00 Uhr                    |

## Wichtiger Hinweis

Alle Angaben basieren auf den Daten des Auswärtigen Amts.
Vor jeder Reise immer tagesaktuell prüfen: https://www.auswaertiges-amt.de
