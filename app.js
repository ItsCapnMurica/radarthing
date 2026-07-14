(function () {
  const cfg = window.APP_CONFIG;

  // ---------- Map setup ----------
  const map = L.map("map", { zoomControl: false }).setView(cfg.defaultCenter, cfg.defaultZoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  let radarLayer = null;
  let radarTimer = null;
  let routeLayer = null;
  let startMarker = null;
  let endMarker = null;
  let userMarker = null;
  let watchId = null;
  let steps = [];
  let activeStepIndex = -1;

  const el = (id) => document.getElementById(id);
  const statusEl = el("status");
  const stepsEl = el("steps");
  const keySetupEl = el("key-setup");

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  // ---------- Panel collapse ----------
  el("panel-toggle").addEventListener("click", () => {
    const panel = el("panel");
    panel.classList.toggle("collapsed");
    el("panel-toggle").textContent = panel.classList.contains("collapsed") ? "+" : "–";
  });

  // ---------- ORS key handling (stored only in this browser, never in the repo) ----------
  function getOrsKey() {
    return localStorage.getItem(cfg.orsKeyStorageName) || "";
  }
  function ensureKeyUi() {
    keySetupEl.classList.toggle("hidden", !!getOrsKey());
  }
  el("save-key-btn").addEventListener("click", () => {
    const val = el("ors-key-input").value.trim();
    if (val) {
      localStorage.setItem(cfg.orsKeyStorageName, val);
      ensureKeyUi();
      setStatus("API key saved on this device.");
    }
  });
  ensureKeyUi();

  // ---------- Live radar (RainViewer, free, no key) ----------
  async function refreshRadar() {
    if (!el("radar-toggle").checked) return;
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const data = await res.json();
      const frames = data.radar && data.radar.past ? data.radar.past : [];
      if (!frames.length) return;
      const latest = frames[frames.length - 1];
      const url = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

      if (radarLayer) map.removeLayer(radarLayer);
      radarLayer = L.tileLayer(url, { opacity: 0.55, zIndex: 500 });
      radarLayer.addTo(map);
    } catch (e) {
      console.error("Radar fetch failed", e);
    }
  }
  el("radar-toggle").addEventListener("change", () => {
    if (el("radar-toggle").checked) {
      refreshRadar();
      radarTimer = setInterval(refreshRadar, 5 * 60 * 1000);
    } else {
      if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
      if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
    }
  });
  refreshRadar();
  radarTimer = setInterval(refreshRadar, 5 * 60 * 1000);

  // ---------- Geocoding (Nominatim, free, no key) ----------
  async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    if (!data.length) throw new Error(`Could not find location: ${query}`);
    return [parseFloat(data[0].lon), parseFloat(data[0].lat)]; // [lon, lat] for ORS
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // ---------- Routing (OpenRouteService) ----------
  async function fetchRoute(startLonLat, endLonLat) {
    const key = getOrsKey();
    if (!key) {
      keySetupEl.classList.remove("hidden");
      throw new Error("Add your free OpenRouteService API key below to route.");
    }
    const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ coordinates: [startLonLat, endLonLat] })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Routing failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  function metersToMiles(m) { return (m / 1609.34).toFixed(1); }

  function renderSteps(feature) {
    stepsEl.innerHTML = "";
    steps = [];
    const segments = feature.properties.segments || [];
    const coords = feature.geometry.coordinates;

    segments.forEach((seg) => {
      (seg.steps || []).forEach((step) => {
        const stepCoordIdx = step.way_points[0];
        const [lon, lat] = coords[stepCoordIdx];
        steps.push({ instruction: step.instruction, distance: step.distance, latlng: [lat, lon] });
      });
    });

    steps.forEach((s, i) => {
      const li = document.createElement("li");
      li.dataset.idx = i;
      li.innerHTML = `<span class="txt">${s.instruction}</span><span class="dist">${metersToMiles(s.distance)} mi</span>`;
      stepsEl.appendChild(li);
    });
  }

  function drawRoute(geojson) {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(geojson, {
      style: { color: "#3d7bfd", weight: 5, opacity: 0.85 }
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  // ---------- Voice guidance ----------
  function speak(text) {
    if (!el("voice-toggle").checked) return;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  }

  function distanceMeters(a, b) {
    const R = 6371000;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const lat1 = a[0] * Math.PI / 180;
    const lat2 = b[0] * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function setActiveStep(idx) {
    if (idx === activeStepIndex) return;
    activeStepIndex = idx;
    [...stepsEl.children].forEach((li, i) => li.classList.toggle("active", i === idx));
    const activeLi = stepsEl.children[idx];
    if (activeLi) activeLi.scrollIntoView({ block: "nearest" });
  }

  function startNavigationTracking() {
    if (!navigator.geolocation || !steps.length) return;
    if (watchId) navigator.geolocation.clearWatch(watchId);

    let announced = new Set();

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const here = [pos.coords.latitude, pos.coords.longitude];

        if (!userMarker) {
          userMarker = L.circleMarker(here, { radius: 7, color: "#3dfd7b", fillOpacity: 0.9 }).addTo(map);
        } else {
          userMarker.setLatLng(here);
        }

        // find nearest upcoming step
        let nearestIdx = activeStepIndex < 0 ? 0 : activeStepIndex;
        let nearestDist = Infinity;
        steps.forEach((s, i) => {
          if (i < activeStepIndex) return;
          const d = distanceMeters(here, s.latlng);
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        });

        setActiveStep(nearestIdx);

        if (nearestDist < 60 && !announced.has(nearestIdx)) {
          announced.add(nearestIdx);
          speak(steps[nearestIdx].instruction);
        } else if (nearestDist < 300 && !announced.has("warn" + nearestIdx)) {
          announced.add("warn" + nearestIdx);
          speak(`In ${Math.round(nearestDist)} meters, ${steps[nearestIdx].instruction}`);
        }
      },
      (err) => console.error("Geolocation watch error", err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  // ---------- Go button ----------
  el("go-btn").addEventListener("click", async () => {
    const startText = el("start-input").value.trim();
    const endText = el("end-input").value.trim();
    if (!endText) return setStatus("Enter a destination.");

    try {
      setStatus("Locating…");
      const startLonLat = startText ? await geocode(startText) : await getCurrentPosition();
      const endLonLat = await geocode(endText);

      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);
      startMarker = L.marker([startLonLat[1], startLonLat[0]]).addTo(map).bindPopup("Start");
      endMarker = L.marker([endLonLat[1], endLonLat[0]]).addTo(map).bindPopup("Destination");

      setStatus("Routing…");
      const route = await fetchRoute(startLonLat, endLonLat);
      const feature = route.features[0];

      drawRoute(route);
      renderSteps(feature);

      const distMi = metersToMiles(feature.properties.summary.distance);
      const durMin = Math.round(feature.properties.summary.duration / 60);
      setStatus(`${distMi} mi · ${durMin} min`);

      speak(`Starting route. ${distMi} miles, about ${durMin} minutes.`);
      startNavigationTracking();
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong.");
    }
  });

  // Click a step to hear it again
  stepsEl.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const idx = parseInt(li.dataset.idx, 10);
    if (!isNaN(idx) && steps[idx]) speak(steps[idx].instruction);
  });
})();
