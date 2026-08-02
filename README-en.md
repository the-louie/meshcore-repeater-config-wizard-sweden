# MeshCore Repeater Config Wizard (Sweden)

> 🇸🇪 Svensk version: [README.md](README.md)

A single-page wizard that generates a complete CLI configuration for a Swedish
[MeshCore](https://meshcore.co.uk/) repeater with as close to zero clicks as
possible. Click the map, type a name, copy the config. Everything else is
prefilled with recommended values and can be adjusted if needed.

The UI is in Swedish, and the wizard only accepts placements inside Sweden's
municipal boundaries.

## How it works

1. **Plats** – click the map to set the repeater position. The län and kommun
   are detected automatically with a point-in-polygon lookup against Swedish
   administrative boundaries, and the region chain (`se`, `se<länskod>`,
   `se<kommunkod>`, optionally `offgrid`) is derived from it. Positions outside
   Sweden are rejected.
2. **Namn** – type a short location name. The prefix is generated automatically
   in one of two formats, selected with a toggle:
   - `SE-<IATA>-` based on the county's airport code (default)
   - `SE<kommunkod>-` based on the selected kommun
   The full name is validated against the 22-byte advert limit and the
   characters MeshCore allows.
3. **Observer (valfritt)** – filling in Wi-Fi credentials switches the config to
   observer firmware with MQTT reporting. Leaving the fields empty produces a
   plain repeater config. SSID and password are restricted to printable ASCII
   without spaces, and an empty password means an open network.

The generated command list updates live on every change and can be copied in
full with one click. Commands are pasted into the device console (for example
via a Web Serial flasher), one at a time, waiting for each response.

### Defaults

| Setting | Value |
| --- | --- |
| Radio profile | EU/UK Narrow, `869.618 MHz / 62.5 kHz / SF8 / CR8` |
| Duty cycle | 10 % |
| Repeater neighbours | 2–4 (`txdelay 0.5`, `direct.txdelay 0.3`) |
| Identifier length | 3 byte (`path.hash.mode 2`) |
| Zero-hop adverts | every 4 hours |
| Flood adverts | every 47 hours |
| AGC reset interval | 500 |
| Multi-acks | 1 |
| RX delay | 0 (disabled) |
| Timezone | Europe/Stockholm |

## Running

The wizard is fully static. Serve the repository root with any web server:

```sh
python3 -m http.server
# then open http://localhost:8000
```

Map tiles are loaded from CARTO at full resolution. Builds that embed a
low-zoom tile set (see below) probe the tile server first and fall back to the
embedded tiles only when it is unreachable, so the map keeps working offline.

## Structure

```
index.html    markup for the two-pane layout (settings left, config right)
style.css     styling, light/dark theme via prefers-color-scheme
js/app.js     all logic: map, boundary lookup, validation, command generation
js/data.js    län and kommun tables (codes and names)
geojson/      Swedish administrative boundaries (admin_level 4 and 7)
vendor/       vendored Leaflet 1.9.4
```

State is persisted in `localStorage` so a reload keeps the selections, except
Wi-Fi credentials which are deliberately never stored.

## Development notes

- No build step and no runtime dependencies beyond the vendored Leaflet.
- `window.__wizardMap` is exposed intentionally so browser tests can convert
  coordinates to pixels for synthetic map clicks.
- Open items are tracked in [TODO.md](TODO.md), and review reports live under
  `__doc/code_reviews/`.

## Map data attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, boundaries via [osm-boundaries.com](https://osm-boundaries.com),
tiles from [CARTO](https://carto.com/).
