const seedRoutes = [];
const legacyDemoNames = new Set([
  "Morning waterfront run",
  "Hill repeat circuit",
  "Sunday lake ride",
  "Office commute walk",
  "Coastal tempo",
  "Airport endurance ride",
  "Fresh Strava sync",
]);

let routes = loadRoutes();
let selectedId = routes[0]?.id ?? null;
let zoom = 1;
let filter = "all";
let query = "";
let deferredInstallPrompt = null;
let watchId = null;
let trackingState = "idle";
let trackingStartedAt = 0;
let pausedAt = 0;
let pausedMs = 0;
let liveDistanceMeters = 0;
let liveElevationMeters = 0;
let livePoints = [];
let timerId = null;
let wakeLock = null;
let pendingStravaCode = null;
let stravaConfig = loadStravaConfig();
let stravaToken = loadStravaToken();

const views = {
  heatmap: document.getElementById("heatmapView"),
  track: document.getElementById("trackView"),
  analytics: document.getElementById("analyticsView"),
  routes: document.getElementById("routesView"),
  settings: document.getElementById("settingsView"),
};

const viewTitles = {
  heatmap: "Heatmap",
  track: "Track run",
  analytics: "Analytics",
  routes: "Routes",
  settings: "Setup",
};

const heatCanvas = document.getElementById("heatCanvas");
const barCanvas = document.getElementById("barCanvas");
const donutCanvas = document.getElementById("donutCanvas");

function loadRoutes() {
  const stored = localStorage.getItem("heatrun.routes");
  if (!stored) return seedRoutes;
  try {
    return JSON.parse(stored).filter((route) => {
      const isLegacyDemo = legacyDemoNames.has(route.name) && !route.recordedAt && !route.stravaId && !route.geoPoints;
      return !isLegacyDemo;
    });
  } catch {
    return seedRoutes;
  }
}

function saveRoutes() {
  localStorage.setItem("heatrun.routes", JSON.stringify(routes));
}

function loadStravaConfig() {
  try {
    return JSON.parse(localStorage.getItem("heatrun.strava.config")) || {};
  } catch {
    return {};
  }
}

function saveStravaConfig(config) {
  stravaConfig = config;
  localStorage.setItem("heatrun.strava.config", JSON.stringify(config));
}

function loadStravaToken() {
  try {
    return JSON.parse(localStorage.getItem("heatrun.strava.token")) || null;
  } catch {
    return null;
  }
}

function saveStravaToken(token) {
  stravaToken = token;
  localStorage.setItem("heatrun.strava.token", JSON.stringify(token));
}

function clearStravaToken() {
  stravaToken = null;
  localStorage.removeItem("heatrun.strava.token");
}

function visibleRoutes() {
  return routes.filter((route) => {
    const matchesSport = filter === "all" || route.sport === filter;
    const haystack = `${route.name} ${route.city} ${route.sport}`.toLowerCase();
    return matchesSport && haystack.includes(query.toLowerCase());
  });
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(260, Math.floor(rect.height * ratio));
}

function drawHeatmap() {
  resizeCanvas(heatCanvas);
  const ctx = heatCanvas.getContext("2d");
  const width = heatCanvas.width;
  const height = heatCanvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#11181d";
  ctx.fillRect(0, 0, width, height);
  drawMapBase(ctx, width, height);

  const scale = Math.min(width, height) * zoom;
  const offsetX = (width - scale) / 2;
  const offsetY = (height - scale * .65) / 2;

  visibleRoutes().forEach((route) => {
    const intensity = route.sport === "ride" ? .72 : route.sport === "walk" ? .42 : 1;
    drawRouteGlow(ctx, route, offsetX, offsetY, scale, intensity);
  });

  const selected = routes.find((route) => route.id === selectedId) || routes[0];
  if (selected) drawRouteLine(ctx, selected, offsetX, offsetY, scale);
  if (livePoints.length > 1) drawLiveRouteLine(ctx, offsetX, offsetY, scale);
}

function drawMapBase(ctx, width, height) {
  ctx.strokeStyle = "rgba(255,255,255,.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(145,160,154,.18)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  const roads = [
    [[.05,.75],[.22,.68],[.42,.66],[.62,.58],[.86,.52]],
    [[.12,.25],[.28,.34],[.52,.36],[.75,.29],[.96,.24]],
    [[.48,.05],[.52,.23],[.50,.42],[.56,.66],[.68,.92]],
    [[.06,.48],[.24,.52],[.41,.47],[.62,.44],[.90,.39]],
  ];
  roads.forEach((road) => path(ctx, road, width, height, 1));
}

function path(ctx, points, width, height, yScale = .65) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const px = x * width;
    const py = y * height * yScale + height * (1 - yScale) / 2;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function routePoint(point, offsetX, offsetY, scale) {
  return [offsetX + point[0] * scale, offsetY + point[1] * scale * .65];
}

function drawRouteGlow(ctx, route, offsetX, offsetY, scale, intensity) {
  const colors = route.sport === "ride"
    ? ["rgba(56,189,248,.22)", "rgba(56,189,248,.03)"]
    : route.sport === "walk"
      ? ["rgba(247,185,85,.2)", "rgba(247,185,85,.02)"]
      : ["rgba(52,211,153,.28)", "rgba(255,107,95,.035)"];

  route.points.forEach((point) => {
    const [x, y] = routePoint(point, offsetX, offsetY, scale);
    const radius = Math.max(44, route.distance * 4.2) * intensity * zoom;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawRouteLine(ctx, route, offsetX, offsetY, scale) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#f7b955";
  ctx.beginPath();
  route.points.forEach((point, index) => {
    const [x, y] = routePoint(point, offsetX, offsetY, scale);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawLiveRouteLine(ctx, offsetX, offsetY, scale) {
  const route = {
    points: normalizeGeoPoints(livePoints),
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ff6b5f";
  ctx.beginPath();
  route.points.forEach((point, index) => {
    const [x, y] = routePoint(point, offsetX, offsetY, scale);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderActivityList() {
  const list = document.getElementById("activityList");
  list.innerHTML = "";
  const shown = visibleRoutes();
  if (shown.length === 0) {
    list.innerHTML = `<div class="empty-state">No activities yet. Connect Strava or track a run to build your heatmap.</div>`;
    return;
  }

  shown.forEach((route) => {
    const item = document.createElement("button");
    item.className = `timeline-item ${route.id === selectedId ? "active" : ""}`;
    item.innerHTML = `<span><strong>${route.name}</strong><small>${route.city} - ${route.distance} km</small></span><span class="sport-pill">${route.sport}</span>`;
    item.addEventListener("click", () => {
      selectedId = route.id;
      renderAll();
    });
    list.appendChild(item);
  });
}

function renderStats() {
  const shown = visibleRoutes();
  const selected = shown.find((route) => route.id === selectedId) || shown[0] || routes[0];
  const total = shown.reduce((sum, route) => sum + route.distance, 0);
  document.getElementById("totalDistance").textContent = `${total.toFixed(1)} km`;
  document.getElementById("activityCount").textContent = shown.length;
  if (!selected) {
    document.getElementById("selectedName").textContent = "No route selected";
    document.getElementById("selectedMeta").textContent = "Import Strava data or track your first run";
    document.getElementById("selectedPace").textContent = "-- /km";
    document.getElementById("selectedElevation").textContent = "0 m";
    return;
  }
  document.getElementById("selectedName").textContent = selected.name;
  document.getElementById("selectedMeta").textContent = `${selected.distance} km - ${selected.sport} - ${selected.minutes} min`;
  document.getElementById("selectedPace").textContent = selected.sport === "ride"
    ? `${(selected.distance / (selected.minutes / 60)).toFixed(1)} km/h`
    : pace(selected.minutes, selected.distance);
  document.getElementById("selectedElevation").textContent = `${selected.elevation} m`;
}

function pace(minutes, distance) {
  const paceValue = minutes / distance;
  const mins = Math.floor(paceValue);
  const secs = Math.round((paceValue - mins) * 60).toString().padStart(2, "0");
  return `${mins}:${secs} /km`;
}

function paceFromMeters(elapsedMs, distanceMeters) {
  if (distanceMeters < 10 || elapsedMs < 1000) return "-- /km";
  const minutes = elapsedMs / 60000;
  const kilometers = distanceMeters / 1000;
  return pace(minutes, kilometers);
}

function drawBars() {
  resizeCanvas(barCanvas);
  const ctx = barCanvas.getContext("2d");
  const width = barCanvas.width;
  const height = barCanvas.height;
  const weeks = buildWeeklyDistances();
  const maxValue = Math.max(...weeks);
  const max = maxValue * 1.15;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#12181d";
  ctx.fillRect(0, 0, width, height);

  if (maxValue === 0) {
    ctx.fillStyle = "#91a09a";
    ctx.font = `600 ${18 * (window.devicePixelRatio || 1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No weekly activity yet", width / 2, height / 2);
    ctx.textAlign = "start";
    return;
  }

  const gap = 18;
  const barWidth = (width - gap * (weeks.length + 1)) / weeks.length;
  weeks.forEach((value, index) => {
    const barHeight = (height - 64) * (value / max);
    const x = gap + index * (barWidth + gap);
    const y = height - 34 - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, height);
    gradient.addColorStop(0, "#34d399");
    gradient.addColorStop(1, "#38bdf8");
    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, barWidth, barHeight, 10);
    ctx.fill();
    ctx.fillStyle = "#91a09a";
    ctx.font = `${14 * (window.devicePixelRatio || 1)}px sans-serif`;
    ctx.fillText(`W${index + 1}`, x + 4, height - 10);
  });
}

function buildWeeklyDistances() {
  const weeks = Array(8).fill(0);
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  routes.forEach((route) => {
    const activityDate = route.recordedAt ? new Date(route.recordedAt) : now;
    if (Number.isNaN(activityDate.getTime())) return;
    const diffWeeks = Math.floor((startOfDay(now) - startOfDay(activityDate)) / weekMs);
    if (diffWeeks >= 0 && diffWeeks < weeks.length) {
      weeks[weeks.length - 1 - diffWeeks] += route.distance || 0;
    }
  });

  return weeks.map((value) => Number(value.toFixed(2)));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function drawDonut() {
  resizeCanvas(donutCanvas);
  const ctx = donutCanvas.getContext("2d");
  const width = donutCanvas.width;
  const height = donutCanvas.height;
  const counts = ["run", "ride", "walk"].map((sport) => routes.filter((route) => route.sport === sport).length);
  const colors = ["#34d399", "#38bdf8", "#f7b955"];
  const total = counts.reduce((sum, count) => sum + count, 0);
  let start = -Math.PI / 2;
  ctx.clearRect(0, 0, width, height);
  if (total === 0) {
    ctx.fillStyle = "#12181d";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#91a09a";
    ctx.font = `600 ${18 * (window.devicePixelRatio || 1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No activities", width / 2, height / 2);
    ctx.textAlign = "start";
    return;
  }
  counts.forEach((count, index) => {
    const angle = (count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = colors[index];
    ctx.lineWidth = Math.min(width, height) * .12;
    ctx.arc(width / 2, height / 2, Math.min(width, height) * .26, start, start + angle);
    ctx.stroke();
    start += angle;
  });
  ctx.fillStyle = "#eef5f1";
  ctx.font = `700 ${28 * (window.devicePixelRatio || 1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`${routes.length}`, width / 2, height / 2 + 8);
  ctx.textAlign = "start";
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
}

function renderInsights() {
  const total = routes.reduce((sum, route) => sum + route.distance, 0);
  if (routes.length === 0) {
    document.getElementById("insights").innerHTML = `
      <li>Your activity library is empty.</li>
      <li>Connect Strava in Setup to import activities.</li>
      <li>Tracked runs and Strava imports stay in local browser storage.</li>
    `;
    return;
  }
  const longest = routes.reduce((best, route) => route.distance > best.distance ? route : best, routes[0]);
  const elevation = routes.reduce((sum, route) => sum + route.elevation, 0);
  document.getElementById("insights").innerHTML = `
    <li>Your activity library covers ${total.toFixed(1)} km across ${routes.length} logged activities.</li>
    <li>${longest.name} is the longest route at ${longest.distance} km.</li>
    <li>Total elevation gain is ${elevation.toLocaleString()} m, useful for weekly load scoring.</li>
  `;
}

function renderRouteTable() {
  const table = document.getElementById("routeTable");
  const shown = visibleRoutes();
  const rows = shown.map((route) => `
    <div class="route-row">
      <span>${route.name}<br><small>${route.city}</small></span>
      <span>${route.sport}</span>
      <span>${route.distance} km</span>
      <span>${route.elevation} m</span>
    </div>
  `).join("");
  table.innerHTML = `<div class="route-row header"><span>Name</span><span>Sport</span><span>Distance</span><span>Elevation</span></div>${rows || `<div class="empty-state">No activities yet.</div>`}`;
}

function switchView(name) {
  Object.values(views).forEach((view) => view.classList.remove("active"));
  views[name].classList.add("active");
  document.getElementById("viewTitle").textContent = viewTitles[name];
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  renderAll();
}

function renderAll() {
  renderStats();
  renderActivityList();
  renderTracker();
  drawHeatmap();
  drawBars();
  drawDonut();
  renderInsights();
  renderRouteTable();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.getElementById("sportFilter").addEventListener("change", (event) => {
  filter = event.target.value;
  renderAll();
});

document.getElementById("routeSearch").addEventListener("input", (event) => {
  query = event.target.value;
  renderAll();
});

document.getElementById("zoomIn").addEventListener("click", () => {
  zoom = Math.min(1.45, zoom + .1);
  drawHeatmap();
});

document.getElementById("zoomOut").addEventListener("click", () => {
  zoom = Math.max(.8, zoom - .1);
  drawHeatmap();
});

document.getElementById("recenter").addEventListener("click", () => {
  zoom = 1;
  drawHeatmap();
});

document.getElementById("quickStravaButton").addEventListener("click", () => {
  if (stravaToken?.refresh_token || stravaToken?.access_token) {
    syncStravaActivities();
  } else {
    switchView("settings");
    setStravaStatus("Add your Strava app credentials, then connect Strava.");
  }
});

document.getElementById("startRun").addEventListener("click", startTracking);
document.getElementById("pauseRun").addEventListener("click", togglePauseTracking);
document.getElementById("finishRun").addEventListener("click", finishTracking);
document.getElementById("discardRun").addEventListener("click", discardTracking);

document.getElementById("importStravaFromRoutes").addEventListener("click", () => {
  document.getElementById("quickStravaButton").click();
});

document.getElementById("resetData").addEventListener("click", () => {
  routes = [];
  selectedId = null;
  saveRoutes();
  renderAll();
});

document.getElementById("saveStravaConfig").addEventListener("click", saveStravaConfigFromForm);
document.getElementById("connectStrava").addEventListener("click", connectStrava);
document.getElementById("exchangeStravaCode").addEventListener("click", exchangePendingStravaCode);
document.getElementById("syncStravaActivities").addEventListener("click", syncStravaActivities);
document.getElementById("disconnectStrava").addEventListener("click", disconnectStrava);

document.getElementById("exportJson").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(routes, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "heatrun-routes.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

const installButton = document.getElementById("installButton");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function initializeStrava() {
  document.getElementById("stravaRedirectUri").value = getRedirectUri();
  document.getElementById("stravaClientId").value = stravaConfig.clientId || "";
  document.getElementById("stravaClientSecret").value = stravaConfig.clientSecret || "";
  document.getElementById("stravaPerPage").value = stravaConfig.perPage || 100;
  document.getElementById("includePrivateActivities").checked = stravaConfig.includePrivate !== false;

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");
  const expectedState = localStorage.getItem("heatrun.strava.state");

  if (error) {
    setStravaStatus(`Strava authorization failed: ${error}`);
    cleanAuthQuery();
    return;
  }

  if (code) {
    pendingStravaCode = code;
    document.getElementById("exchangeStravaCode").hidden = false;
    if (expectedState && returnedState && expectedState !== returnedState) {
      setStravaStatus("Strava returned an unexpected state value. Try connecting again.");
      pendingStravaCode = null;
    } else {
      setStravaStatus("Strava approved access. Tap Finish connection to import activities.");
    }
    cleanAuthQuery();
    return;
  }

  if (stravaToken?.refresh_token || stravaToken?.access_token) {
    setStravaStatus("Strava is connected. Tap Sync activities to import new data.");
  } else {
    setStravaStatus("Create a Strava API app, paste the credentials here, then connect.");
  }
}

function cleanAuthQuery() {
  window.history.replaceState({}, document.title, getRedirectUri());
}

function getRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function saveStravaConfigFromForm() {
  const config = {
    clientId: document.getElementById("stravaClientId").value.trim(),
    clientSecret: document.getElementById("stravaClientSecret").value.trim(),
    perPage: clamp(Number(document.getElementById("stravaPerPage").value) || 100, 1, 200),
    includePrivate: document.getElementById("includePrivateActivities").checked,
  };
  saveStravaConfig(config);
  document.getElementById("stravaPerPage").value = config.perPage;
  setStravaStatus("Strava settings saved locally in this browser.");
  return config;
}

function connectStrava() {
  const config = saveStravaConfigFromForm();
  if (!config.clientId) {
    setStravaStatus("Add your Strava client ID first.");
    return;
  }

  const scope = config.includePrivate ? "read,activity:read_all" : "read,activity:read";
  const state = window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now());
  localStorage.setItem("heatrun.strava.state", state);

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  window.location.href = url.toString();
}

async function exchangePendingStravaCode() {
  const config = saveStravaConfigFromForm();
  if (!pendingStravaCode) {
    setStravaStatus("No Strava authorization code was found. Tap Connect Strava first.");
    return;
  }
  if (!config.clientId || !config.clientSecret) {
    setStravaStatus("Add your Strava client ID and client secret to finish connecting.");
    return;
  }

  setStravaStatus("Finishing Strava connection...");
  try {
    const token = await requestStravaToken({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: pendingStravaCode,
      grant_type: "authorization_code",
    });
    saveStravaToken(token);
    pendingStravaCode = null;
    localStorage.removeItem("heatrun.strava.state");
    document.getElementById("exchangeStravaCode").hidden = true;
    setStravaStatus("Strava connected. Syncing activities...");
    await syncStravaActivities();
  } catch (error) {
    setStravaStatus(`Could not finish Strava connection: ${error.message}`);
  }
}

async function requestStravaToken(params) {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Strava token request failed with ${response.status}`);
  }
  return response.json();
}

async function getValidStravaAccessToken() {
  if (!stravaToken?.access_token && !stravaToken?.refresh_token) {
    throw new Error("Strava is not connected.");
  }
  if (stravaToken?.access_token && Number(stravaToken.expires_at || 0) * 1000 > Date.now() + 60000) {
    return stravaToken.access_token;
  }

  if (!stravaConfig.clientId || !stravaConfig.clientSecret || !stravaToken.refresh_token) {
    throw new Error("Strava needs your client ID, client secret, and refresh token.");
  }

  const token = await requestStravaToken({
    client_id: stravaConfig.clientId,
    client_secret: stravaConfig.clientSecret,
    refresh_token: stravaToken.refresh_token,
    grant_type: "refresh_token",
  });
  saveStravaToken(token);
  return token.access_token;
}

async function syncStravaActivities() {
  saveStravaConfigFromForm();
  setStravaStatus("Syncing Strava activities...");
  try {
    const accessToken = await getValidStravaAccessToken();
    const perPage = clamp(Number(stravaConfig.perPage) || 100, 1, 200);
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Strava activities request failed with ${response.status}`);
    }

    const activities = await response.json();
    const existingIds = new Set(routes.map((route) => String(route.stravaId || "")));
    const imported = [];
    let duplicateCount = 0;
    let skippedNoMap = 0;

    activities.forEach((activity) => {
      const stravaId = String(activity.id);
      if (existingIds.has(stravaId)) {
        duplicateCount += 1;
        return;
      }
      const route = convertStravaActivity(activity);
      if (!route) {
        skippedNoMap += 1;
        return;
      }
      existingIds.add(stravaId);
      imported.push(route);
    });

    if (imported.length > 0) {
      routes = imported.concat(routes);
      selectedId = imported[0].id;
      saveRoutes();
      renderAll();
      switchView("heatmap");
    }

    setStravaStatus(`Imported ${imported.length} activities. Skipped ${duplicateCount} duplicates and ${skippedNoMap} without route maps.`);
  } catch (error) {
    setStravaStatus(`Strava sync failed: ${error.message}`);
  }
}

function convertStravaActivity(activity) {
  const encoded = activity.map?.summary_polyline;
  if (!encoded) return null;

  const geoPoints = decodePolyline(encoded);
  if (geoPoints.length < 2) return null;

  const distanceKm = Number(((activity.distance || 0) / 1000).toFixed(2));
  return {
    id: nextRouteIdForImport(activity.id),
    stravaId: String(activity.id),
    name: activity.name || `Strava activity ${activity.id}`,
    city: [activity.location_city, activity.location_state, activity.location_country].filter(Boolean).join(", ") || "Strava",
    sport: mapStravaSport(activity.sport_type || activity.type),
    distance: distanceKm,
    minutes: Math.max(1, Math.round((activity.moving_time || activity.elapsed_time || 60) / 60)),
    elevation: Math.round(activity.total_elevation_gain || 0),
    points: normalizeGeoPoints(geoPoints),
    geoPoints,
    recordedAt: activity.start_date || new Date().toISOString(),
    source: "strava",
  };
}

function nextRouteIdForImport(stravaId) {
  const numeric = Number(stravaId);
  if (Number.isSafeInteger(numeric)) return numeric;
  return nextRouteId();
}

function mapStravaSport(type = "") {
  const value = String(type).toLowerCase();
  if (value.includes("ride") || value.includes("bike")) return "ride";
  if (value.includes("walk") || value.includes("hike")) return "walk";
  return "run";
}

function decodePolyline(encoded) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];

  while (index < encoded.length) {
    const latResult = decodePolylineValue(encoded, index);
    index = latResult.index;
    lat += latResult.value;

    const lngResult = decodePolylineValue(encoded, index);
    index = lngResult.index;
    lng += lngResult.value;

    points.push({
      lat: lat / 100000,
      lng: lng / 100000,
    });
  }

  return points;
}

function decodePolylineValue(encoded, startIndex) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = null;

  do {
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < encoded.length);

  return {
    index,
    value: result & 1 ? ~(result >> 1) : result >> 1,
  };
}

function disconnectStrava() {
  clearStravaToken();
  pendingStravaCode = null;
  document.getElementById("exchangeStravaCode").hidden = true;
  setStravaStatus("Strava disconnected in this browser.");
}

function setStravaStatus(message) {
  document.getElementById("stravaStatus").textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function canUseLocation() {
  return "geolocation" in navigator;
}

async function startTracking() {
  if (!canUseLocation()) {
    setTrackingStatus("Location is not supported in this browser.");
    return;
  }
  if (!window.isSecureContext) {
    setTrackingStatus("Open the app from HTTPS or localhost to use GPS.");
    return;
  }

  resetLiveRun();
  trackingState = "recording";
  trackingStartedAt = Date.now();
  setTrackingStatus("Waiting for GPS...");
  requestWakeLock();

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    handleLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    }
  );

  timerId = window.setInterval(renderTracker, 1000);
  renderTracker();
}

function togglePauseTracking() {
  if (trackingState === "recording") {
    trackingState = "paused";
    pausedAt = Date.now();
    setTrackingStatus("Paused");
  } else if (trackingState === "paused") {
    trackingState = "recording";
    pausedMs += Date.now() - pausedAt;
    pausedAt = 0;
    setTrackingStatus("Recording run");
  }
  renderTracker();
}

function finishTracking() {
  if (livePoints.length < 2 || liveDistanceMeters < 20) {
    setTrackingStatus("Move a little farther before saving this run.");
    return;
  }

  stopWatcher();
  const elapsedMs = currentElapsedMs();
  const nextId = nextRouteId();
  const savedRoute = {
    id: nextId,
    name: `Tracked run ${new Date().toLocaleDateString()}`,
    city: "GPS recording",
    sport: "run",
    distance: Number((liveDistanceMeters / 1000).toFixed(2)),
    minutes: Math.max(1, Math.round(elapsedMs / 60000)),
    elevation: Math.round(liveElevationMeters),
    points: normalizeGeoPoints(livePoints),
    geoPoints: livePoints,
    recordedAt: new Date().toISOString(),
  };

  routes.unshift(savedRoute);
  selectedId = nextId;
  saveRoutes();
  trackingState = "idle";
  setTrackingStatus("Run saved to routes");
  releaseWakeLock();
  switchView("heatmap");
  renderAll();
}

function discardTracking() {
  stopWatcher();
  resetLiveRun();
  trackingState = "idle";
  setTrackingStatus("Run discarded");
  releaseWakeLock();
  renderAll();
}

function stopWatcher() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function resetLiveRun() {
  liveDistanceMeters = 0;
  liveElevationMeters = 0;
  livePoints = [];
  pausedMs = 0;
  pausedAt = 0;
  trackingStartedAt = 0;
}

function handlePosition(position) {
  const coords = position.coords;
  const point = {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    timestamp: position.timestamp || Date.now(),
  };

  updateLocationReadout(point);

  if (trackingState !== "recording") {
    renderTracker();
    return;
  }

  const previous = livePoints[livePoints.length - 1];
  if (previous) {
    const segmentMeters = haversineMeters(previous, point);
    if (segmentMeters < 3) {
      renderTracker();
      return;
    }
    liveDistanceMeters += segmentMeters;
    if (typeof point.altitude === "number" && typeof previous.altitude === "number") {
      liveElevationMeters += Math.max(0, point.altitude - previous.altitude);
    }
  }

  livePoints.push(point);
  setTrackingStatus("Recording run");
  renderTracker();
  drawHeatmap();
}

function handleLocationError(error) {
  const messages = {
    1: "Location permission was denied.",
    2: "Location is unavailable right now.",
    3: "GPS timed out. Try moving outdoors.",
  };
  setTrackingStatus(messages[error.code] || "Could not read location.");
  if (error.code === 1) {
    stopWatcher();
    trackingState = "idle";
    releaseWakeLock();
  }
  renderTracker();
}

function updateLocationReadout(point) {
  document.getElementById("liveLat").textContent = point.lat.toFixed(6);
  document.getElementById("liveLng").textContent = point.lng.toFixed(6);
  document.getElementById("liveAccuracy").textContent = `${Math.round(point.accuracy)} m`;
  document.getElementById("lastFix").textContent = `Last fix ${new Date(point.timestamp).toLocaleTimeString()}`;
}

function renderTracker() {
  const elapsedMs = currentElapsedMs();
  document.getElementById("liveDistance").textContent = `${(liveDistanceMeters / 1000).toFixed(2)} km`;
  document.getElementById("liveTime").textContent = formatElapsed(elapsedMs);
  document.getElementById("livePace").textContent = paceFromMeters(elapsedMs, liveDistanceMeters);
  document.getElementById("livePoints").textContent = livePoints.length;
  document.getElementById("liveElevation").textContent = `${Math.round(liveElevationMeters)} m`;

  const dot = document.getElementById("recordingDot");
  dot.className = "recording-dot";
  if (trackingState === "recording") dot.classList.add("active");
  if (trackingState === "paused") dot.classList.add("paused");

  document.getElementById("startRun").disabled = trackingState !== "idle";
  document.getElementById("pauseRun").disabled = trackingState === "idle";
  document.getElementById("pauseRun").textContent = trackingState === "paused" ? "Resume" : "Pause";
  document.getElementById("finishRun").disabled = trackingState === "idle";
  document.getElementById("discardRun").disabled = trackingState === "idle";

  renderGpsLog();
}

function renderGpsLog() {
  const log = document.getElementById("gpsLog");
  if (livePoints.length === 0) {
    log.innerHTML = `<div class="gps-log-row"><span>No GPS points yet</span><span>Start a run and allow location access.</span><span>--</span></div>`;
    return;
  }

  log.innerHTML = livePoints.slice(-8).reverse().map((point, index) => `
    <div class="gps-log-row">
      <span>#${livePoints.length - index}</span>
      <span>${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</span>
      <span>${Math.round(point.accuracy)} m</span>
    </div>
  `).join("");
}

function setTrackingStatus(message) {
  document.getElementById("trackingStatus").textContent = message;
}

function currentElapsedMs() {
  if (!trackingStartedAt) return 0;
  const now = trackingState === "paused" && pausedAt ? pausedAt : Date.now();
  return Math.max(0, now - trackingStartedAt - pausedMs);
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function haversineMeters(a, b) {
  const earthRadiusMeters = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(value) {
  return value * Math.PI / 180;
}

function normalizeGeoPoints(points) {
  if (!points.length) return [[.5, .5]];
  if (points.length === 1) return [[.5, .5]];

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || .0001;
  const lngRange = maxLng - minLng || .0001;

  return points.map((point) => {
    const x = .12 + ((point.lng - minLng) / lngRange) * .76;
    const y = .12 + (1 - ((point.lat - minLat) / latRange)) * .76;
    return [Number(x.toFixed(4)), Number(y.toFixed(4))];
  });
}

function nextRouteId() {
  return Math.max(0, ...routes.map((route) => route.id)) + 1;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

initializeStrava();
saveRoutes();
window.addEventListener("resize", renderAll);
renderAll();
