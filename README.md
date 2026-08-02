# MeshCore Repeater-konfigurationsguide (Sverige)

> 🇬🇧 English version: [README-en.md](README-en.md)

En ensidig guide som genererar en komplett CLI-konfiguration för en svensk
[MeshCore](https://meshcore.co.uk/)-repeater med så nära noll klick som
möjligt. Klicka på kartan, skriv ett namn, kopiera konfigurationen. Allt annat
är förifyllt med rekommenderade värden och kan justeras vid behov.

Gränssnittet är på svenska och guiden accepterar bara placeringar innanför
Sveriges kommungränser.

## Så fungerar det

1. **Plats** – klicka på kartan för att sätta repeaterns position. Län och
   kommun identifieras automatiskt med en punkt-i-polygon-sökning mot Sveriges
   administrativa gränser, och regionkedjan (`se`, `se<länskod>`,
   `se<kommunkod>`, eventuellt `offgrid`) härleds från den. Positioner utanför
   Sverige avvisas.
2. **Namn** – skriv ett kort platsnamn. Prefixet genereras automatiskt i ett av
   två format som väljs med en vippknapp:
   - `SE-<IATA>-` utifrån länets flygplatskod (standard)
   - `SE<kommunkod>-` utifrån vald kommun
   Hela namnet valideras mot advert-gränsen på 22 byte och de tecken som
   MeshCore tillåter.
3. **Observer (valfritt)** – fylls Wi-Fi-uppgifterna i växlar konfigurationen
   till observer-firmware med MQTT-rapportering. Lämnas fälten tomma genereras
   en vanlig repeater-konfiguration. SSID och lösenord är begränsade till
   utskrivbar ASCII utan mellanslag, och ett tomt lösenord betyder öppet
   nätverk.

Kommandolistan uppdateras live vid varje ändring och kan kopieras i sin helhet
med ett klick. Kommandona klistras in i enhetens konsol (till exempel via en
Web Serial-flasher), ett i taget, med väntan på svar mellan varje.

### Standardvärden

| Inställning | Värde |
| --- | --- |
| Radioprofil | EU/UK Narrow, `869,618 MHz / 62,5 kHz / SF8 / CR8` |
| Duty cycle | 10 % |
| Repeater-grannar | 2–4 (`txdelay 0.5`, `direct.txdelay 0.3`) |
| Identifierarlängd | 3 byte (`path.hash.mode 2`) |
| Zero-hop-adverts | var fjärde timme |
| Flood-adverts | var 47:e timme |
| AGC-återställningsintervall | 500 |
| Multi-acks | 1 |
| RX-fördröjning | 0 (avstängd) |
| Tidszon | Europe/Stockholm |

## Körning

Guiden är helt statisk. Servera repots rot med valfri webbserver:

```sh
python3 -m http.server
# öppna sedan http://localhost:8000
```

Karttiles laddas från CARTO i full upplösning. Byggen som bäddar in ett
lågzoomat tile-set (se nedan) provar tile-servern först och faller tillbaka på
de inbäddade tilesen bara när den inte kan nås, så kartan fungerar även
offline.

## Struktur

```
index.html    markup för tvåkolumnslayouten (inställningar till vänster, konfiguration till höger)
style.css     styling, ljust/mörkt tema via prefers-color-scheme
js/app.js     all logik: karta, gränssökning, validering, kommandogenerering
js/data.js    läns- och kommuntabeller (koder och namn)
geojson/      Sveriges administrativa gränser (admin_level 4 och 7)
vendor/       vendorerad Leaflet 1.9.4
```

Tillståndet sparas i `localStorage` så att en omladdning behåller valen, med
undantag för Wi-Fi-uppgifter som medvetet aldrig lagras.

## Utvecklingsnoteringar

- Inget byggsteg och inga körtidsberoenden utöver den vendorerade Leaflet.
- `window.__wizardMap` exponeras avsiktligt så att webbläsartester kan omvandla
  koordinater till pixlar för syntetiska kartklick.
- Öppna punkter finns i [TODO.md](TODO.md) och granskningsrapporter ligger
  under `__doc/code_reviews/`.

## Attribution för kartdata

Kartdata © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bidragsgivare,
gränser via [osm-boundaries.com](https://osm-boundaries.com),
tiles från [CARTO](https://carto.com/).
