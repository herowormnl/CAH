# Schaamteloos

Een Nederlandstalig feestspel in de stijl van Cards Against Humanity, gemaakt voor de telefoon. Voor 3 tot 10 spelers.

## Speelwijzen

Op het startscherm kies je hoe je speelt:

| Modus | Hoe | Internet nodig? |
|---|---|---|
| **Eén telefoon** | De telefoon gaat rond. Een tussenscherm zorgt dat niemand andermans kaarten ziet. | Nee |
| **Samen in de kamer** | Iedereen speelt op z'n eigen telefoon. De rechter leest de antwoorden hardop voor. | Ja |
| **Online, vanuit huis** | Iedereen in z'n eigen huis, bijvoorbeeld naast een videogesprek. Iedereen ziet de vraag, alle antwoorden en de uitslag op z'n eigen scherm. | Ja |

Daarna kies je de versie:

- **Normaal**: fout, maar kan nog net op een verjaardag.
- **Grof · 18+**: alle normale kaarten plus een stapel grove (seks, drank, drugs, zwarte humor).

## Spelregels

1. Elke ronde is iemand de **rechter**. Die leest de zwarte kaart voor.
2. De rest kiest stiekem de grappigste witte kaart(en). Blanco kaarten vul je zelf in.
3. De rechter ziet alle antwoorden anoniem en kiest de winnaar. Die krijgt een punt.
4. Wie als eerste het puntentotaal haalt, wint.

## Spelen op meerdere telefoons

- Eén iemand kiest **Nieuw spel maken** en krijgt een code van 4 letters, een QR-code en een link.
- De anderen scannen de QR-code, openen de link of kiezen **Meedoen met een code**.
- De telefoon van de maker houdt het spel bij. **Laat die app open en het scherm aan.** De app vraagt zelf om het scherm aan te houden.
- Valt iemand weg, dan gaat het spel gewoon door. Wie de app weer opent, komt terug met dezelfde kaarten en punten.
- Sluit de maker per ongeluk de app, dan kan die het spel vanaf het startscherm hervatten. De anderen verbinden dan vanzelf opnieuw.

Technisch: de telefoons praten rechtstreeks met elkaar via WebRTC, met de gratis openbare dienst van [PeerJS](https://peerjs.com) om elkaar te vinden. Lukt een rechtstreekse verbinding niet, wat op mobiele data (4G/5G) vaak gebeurt, dan loopt het verkeer via een tussenstation (TURN-server) van [Metered](https://www.metered.ca), app `schaamteloos`. Het spel stuurt alleen wat tekst rond, dus het gratis tegoed van 20 GB per maand is ruim voldoende.

Krijgt iemand toch de melding dat het netwerk de verbinding blokkeert, laat die speler dan via wifi of iemands hotspot meedoen. Kijk ook in het Metered-dashboard of het tegoed niet op is.

## Op je telefoon zetten

Het is een PWA: een gewone webpagina die je als app kunt installeren.

1. Zet GitHub Pages aan voor deze repository (Settings → Pages → kies de branch, map `/`).
2. Open de Pages-link op je telefoon.
3. **iPhone:** Safari → Deel-knop → *Zet op beginscherm*. **Android:** Chrome → menu → *App installeren*.

Na het eerste bezoek werkt "Eén telefoon" ook offline.

Lokaal testen: `python3 -m http.server` en open `http://localhost:8000`.

## Bestanden

- `index.html`: pagina-opbouw
- `style.css`: opmaak (licht en donker thema)
- `cards.js`: alle kaarten, normaal en grof
- `app.js`: spellogica, schermen en verbinding tussen telefoons
- `manifest.webmanifest`, `icon.svg`, `icon-*.png`: app-icoon en installatie-info
- `sw.js`: service worker voor offline gebruik

Kaarten toevoegen: pas `cards.js` aan. Bij `black` staat `___` voor een open plek. Bij `white` begin je met een kleine letter en zet je geen punt aan het eind.
