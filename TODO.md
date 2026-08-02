# TODO

Deferred items from the 2026-08-02 code review, see `__doc/code_reviews/20260802-1142_repeater-wizard-review.md` for the full context. Each entry needs a product decision or upstream verification before implementation.

## Verify the SSID character policy against the device CLI

The wizard rejects spaces and non ASCII characters in the Wi-Fi SSID and password, see `WIFI_ALLOWED` in `js/app.js`. Real world SSIDs may legally contain spaces, and the original meshat.se wizard allowed them. The restriction here exists because `set wifi.ssid <value>` is pasted into the MeshCore serial console and the parser's quoting behavior is unverified. Action, test on real hardware whether the console accepts quoted or space containing SSIDs, and if it does, relax `WIFI_ALLOWED` and the guidance text in `index.html` accordingly.

## Dark theme for embedded map tiles

The single file build embeds only the CARTO `light_all` tile set, so the offline fallback map stays light in dark mode while the page chrome follows the viewer theme. Embedding `dark_all` as well roughly doubles the embedded tile payload, about 1.8 MB extra. Decide whether the review artifact justifies the size, and if so, extend `fetch-tiles.js` and the `tileLayer` selection in `js/app.js` to pick the set matching `mapTheme()`.

## Web Serial transfer

The original wizard could push the configuration over USB through the Web Serial API, see `meshcore-serial-cli.js` on meshat.se. The rewrite intentionally ships copy and paste only. If direct transfer is wanted, port that module, add a connect button to the configuration panel in `index.html`, and gate it on `navigator.serial` support. The command list in `buildCommands()` is already structured as label plus command pairs, so the transfer loop can consume it unchanged.

## Storage schema versioning

`restoreState()` in `js/app.js` now validates every field defensively, and the storage key carries a `-v2` suffix. If the persisted shape changes again, prefer bumping the key suffix together with a small migration, rather than widening the field validators to accept multiple historical shapes.
