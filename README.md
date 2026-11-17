# Schaamteloos

Een Nederlandstalig feestspel in de stijl van Cards Against Humanity, gemaakt voor de telefoon.
Je speelt met 3 tot 10 spelers op **één telefoon** die je rondgeeft.

## Spelen

1. Vul de namen in en kies hoeveel punten je nodig hebt om te winnen.
2. Elke ronde is iemand de **rechter**. Die leest de zwarte kaart hardop voor.
3. De telefoon gaat rond. Elke speler kiest stiekem de grappigste witte kaart(en). Blanco kaarten vul je zelf in.
4. De rechter ziet alle antwoorden anoniem, leest ze voor en kiest de winnaar. Die krijgt een punt.
5. Wie als eerste het puntentotaal haalt, wint.

Een lopend spel wordt op het toestel bewaard, dus je kunt de app sluiten en later verdergaan.

## Op je telefoon zetten

Het is een PWA: een gewone webpagina die je als app kunt installeren.

1. Zet GitHub Pages aan voor deze repository (Settings → Pages → branch kiezen, map `/`).
2. Open de Pages-link op je telefoon.
3. **iPhone:** Safari → Deel-knop → *Zet op beginscherm*. **Android:** Chrome → menu → *App installeren*.

Na het eerste bezoek werkt de app ook offline.

Lokaal testen: `python3 -m http.server` en open `http://localhost:8000`.

## Bestanden

- `index.html`: de hele app (opmaak, kaarten en spellogica)
- `manifest.webmanifest`, `icon.svg`, `icon-*.png`: app-icoon en installatie-info
- `sw.js`: service worker voor offline gebruik

Kaarten toevoegen: pas de lijsten `BLACK` (vragen, `___` is een open plek) en `WHITE` (antwoorden, met kleine letter beginnen) bovenin het script in `index.html` aan.
