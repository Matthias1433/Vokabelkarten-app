# Vokabelkarten

Lokale Vokabelkarten-App mit Spaced Repetition (SM-2), Lernmodi, Statistiken,
CSV/HTML-Import und optionalem Speichern auf der Festplatte (File System Access API).

## Voraussetzungen
- [Node.js](https://nodejs.org) (Version 18 oder neuer)

## Starten (Entwicklung)
```bash
npm install      # einmalig: Abhängigkeiten installieren
npm run dev      # Dev-Server starten -> öffnet http://127.0.0.1:5173
```
Der Dev-Server läuft auf `localhost` (= secure context), daher funktioniert die
**File System Access API** (Arbeitsordner wählen / Auto-Speichern auf die Platte).

## Produktion bauen
```bash
npm run build    # erzeugt den Ordner dist/
npm run preview  # gebaute Version lokal testen
```

## Hinweise
- **Browser:** Festplatten-Speicherung funktioniert in Chromium-Browsern
  (Chrome, Edge, Brave, Opera). Firefox/Safari fallen automatisch auf den
  Browser-Speicher (localStorage) zurück.
- Ohne verbundenen Arbeitsordner speichert die App in localStorage.
- Der gesamte App-Code steckt in `src/App.jsx`.

## Struktur
```
.
├── index.html          # Einstiegspunkt
├── vite.config.js      # Vite-Konfiguration (host/port)
├── package.json
└── src
    ├── main.jsx        # React-Bootstrap
    └── App.jsx         # die komplette App
```
