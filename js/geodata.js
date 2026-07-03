// ============================================================
// Gerçek veri istemcisi — Open-Meteo (anahtarsız, CORS açık)
//  - Yükseklik: Copernicus DEM 90 m (GIS arazi profili)
//  - Hava: basınç seviyesi rüzgârları, CAPE, donma seviyesi,
//    meydan görüş/rüzgâr tahminleri
// Ağ yoksa çağrılar reddedilir; AIAdvisor sentetik modele düşer.
// ============================================================

const GeoData = {
  cache: new Map(),
  online: null, // null: henüz denenmedi, true/false: son durum
  _queue: Promise.resolve(),

  // İstekler seri kuyruktan akar (aralarında 250 ms) — çok sayıda uçuş
  // aynı anda analiz edilirken API'nin dakikalık limitine takılmayı önler.
  _json(url) {
    const run = this._queue.then(async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    const pause = () => new Promise(res => setTimeout(res, 250));
    this._queue = run.then(pause, pause);
    return run;
  },

  _key(prefix, points) {
    return prefix + points.map(p => p.lat.toFixed(2) + "," + p.lon.toFixed(2)).join(";");
  },

  // Nokta listesi için gerçek arazi yükseklikleri (m) — tek istekte ≤100 nokta
  async elevations(points) {
    const key = this._key("elv:", points);
    if (this.cache.has(key)) return this.cache.get(key);
    const lats = points.map(p => p.lat.toFixed(3)).join(",");
    const lons = points.map(p => p.lon.toFixed(3)).join(",");
    const d = await this._json(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
    const res = d.elevation.map(e => Math.max(0, Math.round(e)));
    this.cache.set(key, res);
    this.online = true;
    return res;
  },

  // Seyir irtifasına en yakın basınç seviyesi (hPa)
  levelFor(altM) {
    const p = 1013.25 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
    let best = 200;
    for (const l of [200, 250, 300, 400, 500]) {
      if (Math.abs(l - p) < Math.abs(best - p)) best = l;
    }
    return best;
  },

  altOf(level) {
    return { 200: 11800, 250: 10350, 300: 9150, 400: 7180, 500: 5570 }[level];
  },

  // Rota noktaları boyunca seyir seviyesi + alternatif seviye rüzgârı,
  // CAPE ve donma seviyesi. Saat indeksi uçuş ilerlemesine göre kaydırılır.
  async routeWeather(points, level, altLevel, blockH) {
    const key = this._key(`wx${level}:`, points);
    if (this.cache.has(key)) return this.cache.get(key);
    const lats = points.map(p => p.lat.toFixed(3)).join(",");
    const lons = points.map(p => p.lon.toFixed(3)).join(",");
    const vars = [
      "cape", "freezing_level_height",
      `wind_speed_${level}hPa`, `wind_direction_${level}hPa`,
      `wind_speed_${altLevel}hPa`, `wind_direction_${altLevel}hPa`,
    ].join(",");
    const raw = await this._json(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=${vars}&forecast_days=2&timezone=UTC`);
    const arr = Array.isArray(raw) ? raw : [raw];
    const base = new Date().getUTCHours();
    const res = arr.map((loc, i) => {
      const idx = Math.min(47, base + Math.round((i / Math.max(arr.length - 1, 1)) * blockH));
      const h = loc.hourly || {};
      const g = name => (h[name] && h[name][idx] != null) ? h[name][idx] : null;
      return {
        cape: g("cape") || 0,
        frz: g("freezing_level_height") ?? 3000,
        wind: g(`wind_speed_${level}hPa`) || 0,   // km/sa
        dir: g(`wind_direction_${level}hPa`) || 0,
        wind2: g(`wind_speed_${altLevel}hPa`) || 0,
        dir2: g(`wind_direction_${altLevel}hPa`) || 0,
      };
    });
    this.cache.set(key, res);
    this.online = true;
    return res;
  },

  // Meydanlar için yüzey tahmini (varış saatine kaydırılmış)
  async airportWeather(airports, hourOffset) {
    const key = this._key(`apt${Math.round(hourOffset)}:`, airports);
    if (this.cache.has(key)) return this.cache.get(key);
    const lats = airports.map(a => a.lat.toFixed(3)).join(",");
    const lons = airports.map(a => a.lon.toFixed(3)).join(",");
    const raw = await this._json(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      `&hourly=visibility,wind_speed_10m,wind_gusts_10m,precipitation,cloud_cover_low` +
      `&forecast_days=2&timezone=UTC`);
    const arr = Array.isArray(raw) ? raw : [raw];
    const idx = Math.min(47, new Date().getUTCHours() + Math.round(hourOffset));
    const res = arr.map(loc => {
      const h = loc.hourly || {};
      const g = name => (h[name] && h[name][idx] != null) ? h[name][idx] : null;
      return {
        visM: g("visibility") ?? 9999,
        windKmh: g("wind_speed_10m") || 0,
        gustKmh: g("wind_gusts_10m") || 0,
        precipMm: g("precipitation") || 0,
        cloudLow: g("cloud_cover_low") || 0,
      };
    });
    this.cache.set(key, res);
    this.online = true;
    return res;
  },
};
