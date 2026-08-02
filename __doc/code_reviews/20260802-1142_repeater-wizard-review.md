# Code Review, MeshCore Repeater Configuration Wizard

Date: 2026-08-02 11:42
Scope: `index.html`, `style.css`, `js/app.js`, `js/data.js`
Reviewer: automated senior review pass over the full rewrite of the wizard

## Summary

The wizard is a single page application that generates a MeshCore repeater CLI configuration from two required inputs, a map position and a device name, with all remaining settings prefilled. The code is framework free, uses vendored Leaflet, validates positions against Swedish administrative boundaries with a point in polygon test, and renders all user supplied strings through `textContent`, which gives a solid baseline against XSS. Command generation mirrors the original meshat.se wizard, so the produced CLI sequence is compatible with the established deployment flow.

The review found no critical security vulnerabilities. It found one correctness bug of medium severity in the flood advert flow, two robustness gaps around persisted state, and a small number of maintainability and accessibility improvements. All of them were remediated in this pass except the items listed in `TODO.md`, which need product level decisions or upstream verification.

## Critical Findings

| Issue | Severity | Description | Suggested Fix |
| :--- | :--- | :--- | :--- |
| Invalid flood interval can be copied | Medium | The flood input copies its raw value into state on every keystroke and the command list regenerates immediately, so intermediate values such as `1` or an empty string appear verbatim in `set flood.advert.interval`, and a user who copies at that moment gets an invalid command. Normalization only ran on blur. | Route the value through the shared clamp helper at command build time so the generated command is always valid, while the field itself still normalizes on blur. Implemented. |
| Restored SSID silently produces an open network config | Medium | The Wi-Fi password is intentionally never persisted, but the SSID was. After a page reload the wizard restored the SSID with an empty password, which the new rules interpret as an open network, so a reloaded session could copy `set wifi.pwd ` for a network that actually has a password. | Stop persisting the SSID as well. Observer users retype two short fields, and a silently wrong credential command is worse than the convenience. Implemented. |
| Unvalidated `localStorage` shapes reach live state | Low | `restoreState` used `Object.assign(state, saved)` with no type checks. Stale or hand edited storage could set `lat` to a string, which throws inside `toFixed` and breaks every subsequent render, or set select values that do not exist as options. | Validate every restored field against its expected type and its known set of legal values, and fall back to the defaults otherwise. Implemented. |
| Observer condition duplicated between validator and builder | Low | `wifiStatus()` decides what counts as observer mode, but `buildCommands()` re-derived it independently from `state.wifiSsid.trim()`. The two could drift apart when rules change. | Let `buildCommands()` consume the `wifiStatus()` result. Implemented. |
| Config readiness state invisible to assistive technology | Low | The ready indicator is an emoji marked `aria-hidden`, so screen reader users get no equivalent of the thumbs up versus clock signal beyond the content swap. | Mirror the state into an `aria-label` on the configuration fieldset. Implemented. |
| Opaque combining character range in `normalizeName` | Info | The diacritic stripping regex contained raw combining characters that render as an empty looking range, which is easy to break in a refactor. | Use explicit `̀-ͯ` escapes. Implemented. |
| Mixed key styles in `IATA_BY_COUNTY` | Info | County codes below ten were quoted strings while the rest were numeric literals. Both work through key coercion, but the inconsistency invites an accidental octal or lookup bug during future edits. | Quote every key. Implemented. |
| Probe image handlers survive settlement | Info | `probeTileServer` left `onload` and `onerror` attached after resolving, keeping the image reachable until GC. Harmless in practice, cheap to clear. | Null the handlers inside the settle path. Implemented. |
| Debug handle exposed globally | Info | `window.__wizardMap` is set unconditionally. It is required by the automated browser tests and is harmless, but it should be labeled as intentional so nobody removes or ships it unaware. | Add an explanatory comment. Implemented. |

## Notes That Required No Change

The clipboard fallback uses `document.execCommand("copy")`, which is deprecated but remains the only fallback for non secure contexts, and the primary path uses the async Clipboard API. The full command DOM is rebuilt on every keystroke, which is acceptable at roughly twenty rows and keeps the rendering logic simple. The SSID rule forbids spaces even though real world SSIDs may contain them, this is a deliberate product decision driven by the device CLI parser and is now tracked in `TODO.md` for upstream verification. Comments in the codebase describe behavior and constraints rather than change history, which matches the review requirement.
