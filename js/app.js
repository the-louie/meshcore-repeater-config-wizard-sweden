import { COUNTIES, MUNICIPALITIES } from "./data.js";

const IATA_BY_COUNTY = {
  "01": "STO", "03": "STO", "04": "NYO", "05": "LPI", "06": "JKG",
  "07": "VXO", "08": "KLR", "09": "VBY", "10": "RNB", "12": "MMX",
  "13": "HAD", "14": "GOT", "17": "KSD", "18": "ORB", "19": "VST",
  "20": "BLE", "21": "GVX", "22": "SDL", "23": "OSD", "24": "UME", "25": "LLA",
};

const DELAYS = {
  "0-1": { tx: "0.3", direct: "0.1" },
  "2-4": { tx: "0.5", direct: "0.3" },
  "5-9": { tx: "1.0", direct: "0.5" },
  "10-14": { tx: "1.5", direct: "1.0" },
  "15+": { tx: "2.0", direct: "2.0" },
};

const FORBIDDEN_NAME_CHARACTERS = /[\[\]\\:,?*]/;
// CLI-safe Wi-Fi credentials: printable ASCII without spaces (no åäö etc.).
const WIFI_ALLOWED = /^[\x21-\x7e]+$/;
const STORAGE_KEY = "meshat-repeater-wizard-v2";

const state = {
  lat: null,
  lon: null,
  insideSweden: false,
  county: "",
  municipality: "",
  prefixMode: "iata",
  namePart: "",
  offgrid: false,
  txPower: "",
  neighbors: "2-4",
  hashMode: "2",
  zeroHop: "240",
  flood: "47",
  wifiSsid: "",
  wifiPassword: "",
};

const el = {
  map: document.getElementById("map"),
  locationStatus: document.getElementById("location-status"),
  locationRow: document.getElementById("location-row"),
  locationName: document.getElementById("location-name"),
  locationCoords: document.getElementById("location-coords"),
  regionTags: document.getElementById("region-tags"),
  locationOverride: document.getElementById("location-override"),
  county: document.getElementById("county"),
  municipality: document.getElementById("municipality"),
  offgrid: document.getElementById("offgrid"),
  modeIata: document.getElementById("mode-iata"),
  modeKommun: document.getElementById("mode-kommun"),
  namePrefix: document.getElementById("name-prefix"),
  name: document.getElementById("device-name"),
  nameCount: document.getElementById("name-count"),
  nameFeedback: document.getElementById("name-feedback"),
  wifiFeedback: document.getElementById("wifi-feedback"),
  todoObserver: document.getElementById("todo-observer"),
  txPower: document.getElementById("txpower"),
  neighbors: document.getElementById("neighbors"),
  hashMode: document.getElementById("hashmode"),
  zeroHop: document.getElementById("zerohop"),
  flood: document.getElementById("flood"),
  wifiSsid: document.getElementById("wifi-ssid"),
  wifiPassword: document.getElementById("wifi-password"),
  configSection: document.getElementById("config-section"),
  configBadge: document.getElementById("config-badge"),
  placeholder: document.getElementById("result-placeholder"),
  todoMap: document.getElementById("todo-map"),
  todoName: document.getElementById("todo-name"),
  output: document.getElementById("result-output"),
  commandList: document.getElementById("command-list"),
  copyButton: document.getElementById("copy-button"),
  copyIcon: document.getElementById("copy-icon"),
  checkIcon: document.getElementById("check-icon"),
};

let map = null;
let marker = null;
let mapLayer = null;
let boundaryLayer = null;
let boundariesPromise = null;
let lastCommands = [];

/* ---------- helpers ---------- */

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function normalizeName(value) {
  return value
    .toLocaleLowerCase("sv")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(lan|kommun|municipality|county|city)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function hasControlCharacters(value) {
  return [...value].some((ch) => ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f);
}

function findCounty(name) {
  const normalized = normalizeName(name || "");
  if (!normalized) return null;
  const exact = COUNTIES.find(
    (item) =>
      normalizeName(item.name) === normalized ||
      normalizeName(item.name).replace(/s$/, "") === normalized.replace(/s$/, ""),
  );
  if (exact) return exact;
  return COUNTIES.find(
    (item) =>
      normalized.includes(normalizeName(item.name)) ||
      normalizeName(item.name).includes(normalized),
  );
}

function findMunicipality(name, countyCode) {
  const normalized = normalizeName(name || "");
  if (!normalized) return null;
  return MUNICIPALITIES.find(
    (item) =>
      item.county === countyCode &&
      (normalizeName(item.name) === normalized ||
        normalized.includes(normalizeName(item.name)) ||
        normalizeName(item.name).includes(normalized)),
  );
}

/* ---------- boundaries / point-in-polygon ---------- */

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  (function visit(coords) {
    if (typeof coords[0] === "number") {
      bounds[0] = Math.min(bounds[0], coords[0]);
      bounds[1] = Math.min(bounds[1], coords[1]);
      bounds[2] = Math.max(bounds[2], coords[0]);
      bounds[3] = Math.max(bounds[3], coords[1]);
      return;
    }
    coords.forEach(visit);
  })(geometry.coordinates);
  return bounds;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lon, lat, rings) {
  if (!pointInRing(lon, lat, rings[0])) return false;
  return rings.slice(1).every((hole) => !pointInRing(lon, lat, hole));
}

function geometryContains(geometry, lon, lat) {
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
  }
  return false;
}

function featureContains(feature, lon, lat) {
  const [west, south, east, north] = feature.bbox;
  return (
    lon >= west && lon <= east && lat >= south && lat <= north &&
    geometryContains(feature.geometry, lon, lat)
  );
}

async function loadBoundaries() {
  let data = window.__BOUNDARIES;
  if (!data) {
    const response = await fetch("geojson/sweden-administrative-boundaries.geojson");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  }
  const prepare = (feature) => ({ ...feature, bbox: geometryBounds(feature.geometry) });
  return {
    counties: data.features.filter((f) => f.properties.admin_level === 4).map(prepare),
    municipalities: data.features.filter((f) => f.properties.admin_level === 7).map(prepare),
  };
}

/* ---------- map ---------- */

function mapTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark_all" : "light_all";
}

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-bidragsgivare</a> · gränser via <a href="https://osm-boundaries.com">osm-boundaries.com</a> · kartlager från CARTO';
const TRANSPARENT_TILE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// True when the tile server is unreachable and embedded z4-7 tiles are used instead.
let useEmbeddedTiles = false;

function probeTileServer() {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 4000);
    const done = (ok) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = "https://a.basemaps.cartocdn.com/light_all/0/0/0.png";
  });
}

function tileLayer(style) {
  if (useEmbeddedTiles) {
    // Tile server unreachable (offline or sandboxed): serve the embedded data-URI
    // tiles (z4-7), upscaled beyond that; the vector boundaries stay crisp.
    const InlineTiles = L.TileLayer.extend({
      getTileUrl(coords) {
        return window.__TILES[`${coords.z}/${coords.x}/${coords.y}`] || TRANSPARENT_TILE;
      },
    });
    return new InlineTiles("", { attribution: ATTRIBUTION, maxZoom: 18, maxNativeZoom: 7 });
  }
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    attribution: ATTRIBUTION,
    maxZoom: 18,
    subdomains: "abcd",
  });
}

function setBaseLayer() {
  if (mapLayer) map.removeLayer(mapLayer);
  mapLayer = tileLayer(mapTheme()).addTo(map);
  if (!useEmbeddedTiles) {
    mapLayer.once("tileerror", () => {
      // No tile server available (offline or blocked): boundaries become the base map.
      el.map.classList.add("wizard__map--no-tiles");
      document.getElementById("tile-note").hidden = false;
      boundariesPromise.then((boundaries) => {
        if (boundaryLayer) boundaryLayer.setStyle({ fillOpacity: 0.12 });
        L.geoJSON(
          boundaries.municipalities.map(({ bbox, ...feature }) => feature),
          {
            interactive: false,
            style: { color: "#1f7a3d", fill: false, opacity: 0.35, weight: 0.6 },
          },
        ).addTo(map);
      }).catch(() => {});
    });
  }
}

async function initMap() {
  map = L.map(el.map, {
    maxBounds: [[53, 8], [71, 26]],
    maxBoundsViscosity: 0.75,
    minZoom: 4,
    scrollWheelZoom: true,
  }).setView([62.0, 15.0], 5);
  // Intentional debug handle, the automated browser tests use it to convert
  // coordinates to pixels for synthetic map clicks.
  window.__wizardMap = map;
  boundariesPromise = loadBoundaries();

  // Opportunistic tiles: prefer the live tile server for full resolution and
  // fall back to the embedded low-zoom set only when it is unreachable.
  if (window.__TILES) useEmbeddedTiles = !(await probeTileServer());
  setBaseLayer();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setBaseLayer);
  map.on("click", (event) => setLocation(event.latlng.lat, event.latlng.lng));

  try {
    const boundaries = await boundariesPromise;
    boundaryLayer = L.geoJSON(
      boundaries.counties.map(({ bbox, ...feature }) => feature),
      {
        interactive: false,
        style: { color: "#1f7a3d", fillColor: "#1f7a3d", fillOpacity: 0.025, opacity: 0.5, weight: 1 },
      },
    ).addTo(map);
  } catch {
    setStatus("Kommungränserna kunde inte läsas in. Välj län och kommun manuellt.", "error");
    el.locationOverride.hidden = false;
  }

  if (state.lat !== null && state.lon !== null) {
    setMarker(state.lat, state.lon);
    lookupRegions(state.lat, state.lon);
  }
}

const pinIcon = () =>
  L.divIcon({ className: "wizard-pin", iconSize: [16, 16], iconAnchor: [8, 8] });

function setMarker(lat, lon) {
  if (marker) marker.setLatLng([lat, lon]);
  else marker = L.marker([lat, lon], { icon: pinIcon(), interactive: false }).addTo(map);
}

function setStatus(message, kind = "") {
  el.locationStatus.textContent = message;
  el.locationStatus.hidden = !message;
  el.locationStatus.classList.toggle("wizard__alert", kind === "error");
  el.locationStatus.classList.toggle("wizard__hint", kind !== "error");
  if (kind) el.locationStatus.dataset.state = kind;
  else delete el.locationStatus.dataset.state;
}

async function setLocation(lat, lon) {
  state.lat = lat;
  state.lon = lon;
  setMarker(lat, lon);
  await lookupRegions(lat, lon);
}

async function lookupRegions(lat, lon) {
  setStatus("Söker efter län och kommun …");
  try {
    const boundaries = await boundariesPromise;
    if (lat !== state.lat || lon !== state.lon) return;
    const countyBoundary = boundaries.counties.find((f) => featureContains(f, lon, lat));
    const municipalityBoundary = boundaries.municipalities.find((f) => featureContains(f, lon, lat));
    state.insideSweden = Boolean(countyBoundary && municipalityBoundary);
    const county = findCounty(countyBoundary?.properties.name);
    const municipality = county
      ? findMunicipality(municipalityBoundary?.properties.name, county.code)
      : null;

    state.county = county?.code || "";
    state.municipality = municipality?.code || "";
    el.county.value = state.county;
    fillMunicipalities(state.county, state.municipality);

    if (!state.insideSweden) {
      setStatus("Platsen ligger utanför Sveriges kommungränser. Markera en plats inom Sverige.", "error");
      el.locationOverride.hidden = true;
    } else if (county && municipality) {
      setStatus("");
    } else if (county) {
      setStatus(`${county.name} hittades, men inte kommunen. Välj kommun i listan.`, "error");
      el.locationOverride.hidden = false;
    } else {
      setStatus("Länet kunde inte identifieras. Välj län och kommun i listorna.", "error");
      el.locationOverride.hidden = false;
    }
  } catch {
    state.insideSweden = false;
    setStatus("Sveriges kommungränser kunde inte läsas in. Ladda om sidan och försök igen.", "error");
  }
  update();
}

/* ---------- selects ---------- */

function fillCounties() {
  el.county.replaceChildren(
    new Option("Välj län …", ""),
    ...COUNTIES.map((item) => new Option(`${item.name} (${item.code})`, item.code)),
  );
}

function fillMunicipalities(countyCode, selectedCode = "") {
  const items = MUNICIPALITIES.filter((item) => item.county === countyCode);
  el.municipality.replaceChildren(
    new Option("Välj kommun …", ""),
    ...items.map((item) => new Option(`${item.name} (${item.code})`, item.code)),
  );
  el.municipality.value = selectedCode;
}

/* ---------- name ---------- */

function currentPrefix() {
  const municipality = MUNICIPALITIES.find((item) => item.code === state.municipality);
  const iata = IATA_BY_COUNTY[state.county];
  if (state.prefixMode === "kommun") {
    return municipality ? `SE${municipality.code}-` : "SE····-";
  }
  return iata ? `SE-${iata}-` : "SE-···-";
}

function prefixReady() {
  if (state.prefixMode === "kommun") return Boolean(state.municipality);
  return Boolean(IATA_BY_COUNTY[state.county]);
}

function fullName() {
  return `${currentPrefix()}${state.namePart}`.normalize("NFC").trim();
}

// `pending` marks states where the name itself is fine but another required
// step is missing, they render as neutral guidance rather than as errors.
function nameStatus() {
  const part = state.namePart;
  const bytes = byteLength(prefixReady() ? fullName() : part);
  if (!part) {
    return { ok: false, pending: true, bytes, message: "Skriv ett kort platsnamn efter prefixet." };
  }
  if (hasControlCharacters(part) || FORBIDDEN_NAME_CHARACTERS.test(part)) {
    return { ok: false, pending: false, bytes, message: "Namnet innehåller ett tecken som MeshCore inte tillåter ( [ ] \\ : , ? * )." };
  }
  if (bytes > 22) {
    return { ok: false, pending: false, bytes, message: "Korta namnet – hela namnet får vara högst 22 byte." };
  }
  if (!prefixReady()) {
    return { ok: false, pending: true, bytes, message: "Prefixet blir klart när platsen är vald på kartan." };
  }
  return { ok: true, pending: false, bytes, message: "Namnet får plats tillsammans med positionen i en advert." };
}

/* ---------- observer / Wi-Fi ---------- */

// Observer mode is implied by a filled-in SSID; empty fields mean a plain repeater.
function wifiStatus() {
  const ssid = state.wifiSsid.trim();
  const password = state.wifiPassword;
  const attempted = ssid.length > 0 || password.length > 0;
  const charHint =
    "Endast bokstäver a–z, siffror och vanliga specialtecken – inga mellanslag och inga åäö eller andra nationella tecken.";
  if (!attempted) return { ok: true, observer: false, attempted, message: "" };
  if (!ssid)
    return { ok: false, observer: true, attempted, message: "Ange SSID – eller töm båda fälten för en vanlig repeater." };
  if (!WIFI_ALLOWED.test(ssid))
    return { ok: false, observer: true, attempted, message: `SSID innehåller mellanslag eller otillåtna tecken. ${charHint}` };
  if (password) {
    if (!WIFI_ALLOWED.test(password))
      return { ok: false, observer: true, attempted, message: `Lösenordet innehåller mellanslag eller otillåtna tecken. ${charHint}` };
    if (password.length < 8 || password.length > 63)
      return { ok: false, observer: true, attempted, message: "Lösenordet ska vara 8–63 tecken (eller tomt för öppna nätverk)." };
  }
  return { ok: true, observer: true, attempted, message: "" };
}

/* ---------- commands ---------- */

// Valid flood intervals are 0 (disabled) or 3 to 168 hours. The field itself
// normalizes on blur, this helper guarantees the generated command is valid
// even while an intermediate value is being typed.
function clampFloodValue(raw) {
  let value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) value = 47;
  if (value > 0 && value < 3) value = 3;
  if (value > 168) value = 168;
  return String(value);
}

function buildCommands() {
  const regionChain = [
    "se",
    `se${state.county}`,
    `se${state.municipality}`,
    ...(state.offgrid ? ["offgrid"] : []),
  ].join(" ");

  const commands = [
    { label: "Ange repeaterns namn", command: `set name ${fullName()}` },
    { label: "Använd radioprofilen EU/UK (Narrow)", command: "set radio 869.618,62.5,8,8" },
  ];
  if (state.txPower) {
    commands.push({
      label: `Ställ LoRa-kretsens sändeffekt på ${state.txPower} dBm`,
      command: `set tx ${state.txPower}`,
    });
  }
  commands.push(
    { label: "Sätt duty cycle till 10 %", command: "set dutycycle 10" },
    { label: "Återställ mottagarens förstärkningsreglering med jämna mellanrum", command: "set agc.reset.interval 500" },
    { label: "Aktivera stöd för flera kvittenser", command: "set multi.acks 1" },
    { label: "Stäng av den experimentella mottagningsfördröjningen", command: "set rxdelay 0" },
  );
  const delay = DELAYS[state.neighbors];
  if (delay) {
    commands.push(
      { label: "Ställ in fördröjning för flood-trafik", command: `set txdelay ${delay.tx}` },
      { label: "Ställ in fördröjning för direkttrafik", command: `set direct.txdelay ${delay.direct}` },
    );
  }
  commands.push(
    { label: "Ställ in identifierarlängd för adverts", command: `set path.hash.mode ${state.hashMode}` },
    { label: "Ställ in intervallet för zero-hop-adverts", command: `set advert.interval ${state.zeroHop}` },
    { label: "Ställ in intervallet för flood-adverts", command: `set flood.advert.interval ${clampFloodValue(state.flood)}` },
    { label: "Ange latitud", command: `set lat ${state.lat.toFixed(6)}` },
    { label: "Ange longitud", command: `set lon ${state.lon.toFixed(6)}` },
    { label: "Använd svensk tidszon", command: "set timezone Europe/Stockholm" },
    { label: "Tillåt trafik utan regionetikett", command: "region allowf *" },
    {
      label: state.offgrid
        ? "Skapa regionkedjan för Sverige, län, kommun och offgrid"
        : "Skapa regionkedjan för Sverige, län och kommun",
      command: `region def ${regionChain}`,
    },
    { label: "Spara regioner", command: "region save" },
  );
  if (wifiStatus().observer) {
    const password = state.wifiPassword;
    commands.push(
      {
        label: "IATA-kod – sätts automatiskt från valt län, krävs för observer",
        command: `set mqtt.iata ${IATA_BY_COUNTY[state.county]}`,
      },
      { label: "Wi-Fi-nätverkets namn", command: `set wifi.ssid ${state.wifiSsid.trim()}` },
      {
        label: "Wi-Fi-lösenord (tomt = öppet nätverk)",
        command: `set wifi.pwd ${password}`,
        display: `set wifi.pwd ${password ? "••••••••" : ""}`,
      },
      {
        label: "MQTT-server meshcore-mqtt.meshat.se:443 (TLS)",
        command: "set mqtt1.preset meshat.se",
      },
    );
  }
  commands.push({ label: "Starta om repeatern", command: "reboot" });
  return commands;
}

/* ---------- rendering ---------- */

function update() {
  // Location summary
  const county = COUNTIES.find((item) => item.code === state.county);
  const municipality = MUNICIPALITIES.find((item) => item.code === state.municipality);
  const hasPosition = state.lat !== null && state.lon !== null;
  const locationDone = hasPosition && state.insideSweden && Boolean(county && municipality);

  el.locationRow.hidden = !hasPosition;
  if (hasPosition) {
    el.locationName.textContent =
      county && municipality ? `${municipality.name}, ${county.name}` : "Okänd plats";
    el.locationCoords.textContent = `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`;
    el.regionTags.replaceChildren(
      ...(county && municipality
        ? [`se`, `se${county.code}`, `se${municipality.code}`, ...(state.offgrid ? ["offgrid"] : [])]
        : []
      ).map((tag) => {
        const code = document.createElement("code");
        code.textContent = tag;
        return code;
      }),
    );
  }

  // Name / prefix
  el.namePrefix.textContent = currentPrefix();
  const name = nameStatus();
  el.nameCount.textContent = `${name.bytes} / 22 byte`;
  el.nameCount.dataset.state =
    !state.namePart || name.pending ? "neutral" : name.ok ? "ok" : "error";
  el.nameFeedback.textContent = name.message;
  el.nameFeedback.dataset.state = !name.ok && !name.pending ? "error" : "";

  // Observer section
  const wifi = wifiStatus();
  el.wifiFeedback.hidden = wifi.ok;
  el.wifiFeedback.textContent = wifi.message;

  // Result panel
  const ready = locationDone && name.ok && wifi.ok;
  el.todoMap.dataset.done = String(locationDone);
  el.todoName.dataset.done = String(Boolean(state.namePart) && name.ok);
  el.todoObserver.hidden = !wifi.attempted;
  el.todoObserver.dataset.done = String(wifi.ok);
  el.placeholder.hidden = ready;
  el.output.hidden = !ready;
  el.configSection.classList.toggle("is-ready", ready);
  el.configBadge.textContent = ready ? "👍" : "🕐";
  el.configSection.setAttribute(
    "aria-label",
    ready ? "Konfiguration, klar att kopiera" : "Konfiguration, väntar på obligatoriska val",
  );

  if (ready) {
    lastCommands = buildCommands();
    el.commandList.replaceChildren(
      ...lastCommands.map((item) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.className = "cmd-label";
        label.textContent = item.label;
        const code = document.createElement("code");
        code.textContent = item.display || item.command;
        li.append(label, code);
        return li;
      }),
    );
  } else {
    lastCommands = [];
  }

  saveState();
}

/* ---------- clipboard ---------- */

async function copyCommands() {
  const text = lastCommands.map((item) => item.command).join("\n");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  el.copyButton.dataset.copied = "true";
  el.copyIcon.hidden = true;
  el.checkIcon.hidden = false;
  setTimeout(() => {
    delete el.copyButton.dataset.copied;
    el.copyIcon.hidden = false;
    el.checkIcon.hidden = true;
  }, 1500);
}

/* ---------- persistence ---------- */

// Wi-Fi credentials are deliberately never persisted. Restoring an SSID without
// its password would regenerate the config as an open network, which is worse
// than asking observer users to retype two short fields.
function saveState() {
  try {
    const { lat, lon, county, municipality, prefixMode, namePart, offgrid,
      txPower, neighbors, hashMode, zeroHop, flood } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lat, lon, county, municipality, prefixMode, namePart, offgrid,
      txPower, neighbors, hashMode, zeroHop, flood,
    }));
  } catch { /* private browsing etc. */ }
}

// Every restored field is validated against its expected type and its known
// legal values, so stale or hand edited storage can never break rendering.
function restoreState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch { /* ignore */ }
  if (!saved || typeof saved !== "object") return;

  const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

  state.lat = finite(saved.lat);
  state.lon = finite(saved.lon);
  if (state.lat === null || state.lon === null) {
    state.lat = null;
    state.lon = null;
  }
  state.county = COUNTIES.some((item) => item.code === saved.county) ? saved.county : "";
  state.municipality = MUNICIPALITIES.some(
    (item) => item.code === saved.municipality && item.county === state.county,
  )
    ? saved.municipality
    : "";
  state.prefixMode = oneOf(saved.prefixMode, ["iata", "kommun"], "iata");
  state.namePart = typeof saved.namePart === "string" ? saved.namePart : "";
  state.offgrid = saved.offgrid === true;
  state.txPower = oneOf(saved.txPower, ["", "22", "20", "17", "14"], "");
  state.neighbors = oneOf(saved.neighbors, ["", ...Object.keys(DELAYS)], "2-4");
  state.hashMode = oneOf(saved.hashMode, ["1", "2"], "2");
  state.zeroHop = oneOf(saved.zeroHop, ["0", "60", "120", "180", "240"], "240");
  state.flood = clampFloodValue(saved.flood);

  el.offgrid.checked = state.offgrid;
  el.name.value = state.namePart;
  el.txPower.value = state.txPower;
  el.neighbors.value = state.neighbors;
  el.hashMode.value = state.hashMode;
  el.zeroHop.value = state.zeroHop;
  el.flood.value = state.flood;
  el.county.value = state.county;
  fillMunicipalities(state.county, state.municipality);
  setPrefixMode(state.prefixMode, false);
}

/* ---------- events ---------- */

function setPrefixMode(mode, rerender = true) {
  state.prefixMode = mode;
  const iata = mode === "iata";
  el.modeIata.classList.toggle("is-active", iata);
  el.modeKommun.classList.toggle("is-active", !iata);
  el.modeIata.setAttribute("aria-pressed", String(iata));
  el.modeKommun.setAttribute("aria-pressed", String(!iata));
  if (rerender) update();
}

function clampFlood() {
  const value = clampFloodValue(el.flood.value);
  el.flood.value = value;
  state.flood = value;
}

function bindEvents() {
  el.modeIata.addEventListener("click", () => setPrefixMode("iata"));
  el.modeKommun.addEventListener("click", () => setPrefixMode("kommun"));

  el.name.addEventListener("input", () => {
    state.namePart = el.name.value;
    update();
  });

  el.county.addEventListener("change", () => {
    state.county = el.county.value;
    state.municipality = "";
    fillMunicipalities(state.county);
    update();
  });
  el.municipality.addEventListener("change", () => {
    state.municipality = el.municipality.value;
    update();
  });
  el.offgrid.addEventListener("change", () => {
    state.offgrid = el.offgrid.checked;
    update();
  });

  el.txPower.addEventListener("change", () => {
    state.txPower = el.txPower.value;
    update();
  });
  el.neighbors.addEventListener("change", () => {
    state.neighbors = el.neighbors.value;
    update();
  });
  el.hashMode.addEventListener("change", () => {
    state.hashMode = el.hashMode.value;
    update();
  });
  el.zeroHop.addEventListener("change", () => {
    state.zeroHop = el.zeroHop.value;
    update();
  });
  el.flood.addEventListener("input", () => {
    state.flood = el.flood.value;
    update();
  });
  el.flood.addEventListener("change", () => {
    clampFlood();
    update();
  });

  el.wifiSsid.addEventListener("input", () => {
    state.wifiSsid = el.wifiSsid.value;
    update();
  });
  el.wifiPassword.addEventListener("input", () => {
    state.wifiPassword = el.wifiPassword.value;
    update();
  });

  el.copyButton.addEventListener("click", copyCommands);
}

/* ---------- init ---------- */

fillCounties();
fillMunicipalities("");
restoreState();
bindEvents();
update();
initMap();
