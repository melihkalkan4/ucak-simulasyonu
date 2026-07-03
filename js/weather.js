// ============================================================
// Dinamik hava durumu: hareket eden fırtına hücreleri +
// havalimanı meteorolojisi (rüzgâr, görüş)
// ============================================================

class WeatherSystem {
  constructor() {
    this.cells = [];        // aktif fırtına/türbülans hücreleri
    this.nextId = 1;
    this.airportWx = {};    // kod -> { windKt, visM }
    this.lastWxRefresh = -9999;
  }

  init(t) {
    for (let i = 0; i < 5; i++) this.spawnCell(t);
    this.refreshAirports(t, true);
  }

  spawnCell(t) {
    const types = [
      { kind: "TS",  label: "Oraj (fırtına)",   topMin: 10500, topMax: 14500, intMin: 2 }, // gök gürültülü fırtına
      { kind: "TURB", label: "Türbülans sahası", topMin: 9000,  topMax: 12500, intMin: 1 },
      { kind: "ICE", label: "Buzlanma bölgesi",  topMin: 6500,  topMax: 9500,  intMin: 1 },
    ];
    const tp = types[Math.floor(Math.random() * types.length)];
    const intensity = Math.min(3, tp.intMin + Math.floor(Math.random() * 3));
    this.cells.push({
      id: this.nextId++,
      kind: tp.kind, label: tp.label,
      lat: -35 + Math.random() * 95,          // -35 .. 60
      lon: -95 + Math.random() * 240,         // -95 .. 145
      radius: 90 + Math.random() * 240,       // km
      intensity,                               // 1 hafif, 2 orta, 3 şiddetli
      top: tp.topMin + Math.random() * (tp.topMax - tp.topMin), // tavan (m)
      vLon: 0.25 + Math.random() * 0.45,      // derece/saat doğuya sürüklenme
      vLat: (Math.random() - 0.5) * 0.2,
      expires: t + 180 + Math.random() * 420, // 3-10 saat ömür
    });
  }

  update(t, dt) {
    // hücreleri hareket ettir, süresi dolanları kaldır
    this.cells = this.cells.filter(c => c.expires > t);
    for (const c of this.cells) {
      c.lon += c.vLon * dt / 60;
      c.lat += c.vLat * dt / 60;
    }
    // ortalama ~2 saatte bir yeni hücre
    if (Math.random() < dt / 120) this.spawnCell(t);
    if (this.cells.length < 3) this.spawnCell(t);
    // havalimanı meteorolojisi 3 saatte bir yenilenir
    if (t - this.lastWxRefresh >= 180) this.refreshAirports(t, false);
  }

  refreshAirports(t, initial) {
    this.lastWxRefresh = t;
    for (const code of Object.keys(AIRPORTS)) {
      const foggy = Math.random() < 0.07;   // %7 sis/düşük görüş
      const stormy = this.cellAt(AIRPORTS[code]) != null;
      this.airportWx[code] = {
        windKt: Math.round(4 + Math.random() * (stormy ? 42 : 26)),
        visM: foggy ? Math.round(150 + Math.random() * 650) : 9999,
      };
    }
  }

  // verilen konumun üzerindeki hücre (varsa)
  cellAt(pos, margin = 0) {
    for (const c of this.cells) {
      if (distKm(pos, c) < c.radius + margin) return c;
    }
    return null;
  }

  wx(code) {
    return this.airportWx[code] || { windKt: 10, visM: 9999 };
  }

  // bekleme paterninde "hava düzeldi" iyileşmesi
  improve(code) {
    const w = this.airportWx[code];
    if (w) { w.visM = 5000; w.windKt = Math.min(w.windKt, 18); }
  }
}
