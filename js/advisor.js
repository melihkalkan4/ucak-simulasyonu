// ============================================================
// AI Uçuş Danışmanı (dispatch destek sistemi)
//  - GIS arazi profili (gerçek DEM) → MSA / tek-motor drift-down
//  - Gerçek hava (Open-Meteo): seviye rüzgârları, CAPE, buzlanma,
//    varış meydanı görüş/hamle tahmini
//  - Simülasyon hücreleriyle kesişim tahmini
//  - Rota varyantı (kuzey/güney), irtifa ve yakıt önerileri;
//    uygun olanları otomatik uygular
//  - Uçak başına öngörülü bakım riski
// ============================================================

const RISK_LABELS = [
  [70, "YÜKSEK", "alert"],
  [40, "ORTA", "warn"],
  [0, "DÜŞÜK", "ok"],
];

class AIAdvisor {
  constructor(sim) { this.sim = sim; }

  // ---- Uçak başına öngörülü bakım riski (0-100) ----
  maintenanceRisk(ac) {
    return Math.max(0, Math.min(100, Math.round(
      ac.hoursSinceMaint * 1.1 + ac.eventCount * 22 + (ac.needsCheck ? 25 : 0))));
  }

  riskLabel(score) {
    for (const [min, label, level] of RISK_LABELS) if (score >= min) return { label, level };
  }

  // ============== UÇUŞ ANALİZİ ==============
  async analyzeFlight(f) {
    const rep = {
      status: "gerçek veri", categories: { "Fırtına": 8, "Rüzgâr": 8, "Arazi": 8, "Buzlanma": 5, "Varış": 8, "Uçak": 5 },
      findings: [], fuelExtraKg: 0, terrain: null, wind: null,
      route: "direkt", savingMin: 0, applied: [],
    };
    try {
      await this._analyzeReal(f, rep);
    } catch (e1) {
      try {
        // geçici ağ/limit hatası olabilir — raporu sıfırla, bir kez daha dene
        await new Promise(res => setTimeout(res, 2500));
        rep.findings = []; rep.fuelExtraKg = 0;
        for (const k of Object.keys(rep.categories)) rep.categories[k] = k === "Buzlanma" || k === "Uçak" ? 5 : 8;
        await this._analyzeReal(f, rep);
      } catch (e2) {
        console.warn(`AI gerçek veri alınamadı (${f.number}):`, e2);
        GeoData.online = false;
        rep.status = "sentetik model (çevrimdışı)";
        this._analyzeSynthetic(f, rep);
      }
    }
    this._commonChecks(f, rep);
    const vals = Object.values(rep.categories);
    rep.overall = Math.round(Math.min(100,
      Math.max(...vals) * 0.65 + vals.reduce((s, x) => s + x, 0) / vals.length * 0.35));
    const { label, level } = this.riskLabel(rep.overall);
    f.report = rep;
    this.sim.addLog(`AI analiz: ${f.number} risk ${label} (${rep.overall}/100) — ${rep.findings.length} bulgu`,
      level === "ok" ? "info" : level);
    this._apply(f, rep);
    return rep;
  }

  add(rep, cat, score, sev, text) {
    rep.categories[cat] = Math.max(rep.categories[cat], score);
    rep.findings.push({ sev, text });
  }

  // ---- Gerçek verili analiz ----
  async _analyzeReal(f, rep) {
    const n = Math.max(8, Math.min(20, Math.round(f.routeDist / 350)));
    const mid = gcPoint(f.origin, f.dest, 0.5);
    const variants = f.routeDist > 1500 ? [
      { name: "direkt", via: null },
      { name: "kuzey varyantı", via: { lat: Math.min(70, mid.lat + 4), lon: mid.lon } },
      { name: "güney varyantı", via: { lat: Math.max(-50, mid.lat - 4), lon: mid.lon } },
    ] : [{ name: "direkt", via: null }];
    for (const v of variants) {
      v.pts = samplePath(f.origin, v.via, f.dest, n);
      v.dist = v.via ? distKm(f.origin, v.via) + distKm(v.via, f.dest) : f.routeDist;
    }

    // --- GIS: tüm varyant arazi profilleri tek DEM isteğinde ---
    const elevs = await GeoData.elevations(variants.flatMap(v => v.pts));
    variants.forEach((v, vi) => {
      v.elev = elevs.slice(vi * (n + 1), (vi + 1) * (n + 1));
      v.maxElev = Math.max(...v.elev);
      v.msa = v.maxElev + 610; // arazi + 2000 ft emniyet
    });
    const direct = variants[0];
    rep.terrain = { profile: direct.elev, maxElev: direct.maxElev, msa: direct.msa };

    // --- Gerçek seviye rüzgârları + CAPE + donma seviyesi ---
    const cruiseAlt = f.cruiseAltFor();
    const level = GeoData.levelFor(cruiseAlt);
    const altLevel = level >= 400 ? 500 : { 200: 250, 250: 300, 300: 400 }[level];
    const blockH = f.routeDist / (f.type.cruiseSpeed * 0.85);
    const wx = await GeoData.routeWeather(direct.pts, level, altLevel, blockH);

    const comps = [], comps2 = [];
    for (let i = 0; i < direct.pts.length; i++) {
      const j = Math.min(i + 1, direct.pts.length - 1);
      const brg = bearing(direct.pts[i === j ? i - 1 : i], direct.pts[j]);
      comps.push(-wx[i].wind * Math.cos(rad(wx[i].dir - brg)));
      comps2.push(-wx[i].wind2 * Math.cos(rad(wx[i].dir2 - brg)));
    }
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const avgComp = avg(comps), avgComp2 = avg(comps2);
    rep.wind = { avgComp: Math.round(avgComp), samples: comps.map(c => Math.round(c)), level };

    // --- Fırtına (CAPE) ---
    const maxCape = Math.max(...wx.map(w => w.cape));
    if (maxCape > 2500) {
      this.add(rep, "Fırtına", 80, "alert",
        `Rota üzerinde şiddetli konvektif potansiyel (CAPE ${Math.round(maxCape)} J/kg) — sapma payı ayrıldı`);
      rep.fuelExtraKg += f.type.fuelBurn * 0.25;
    } else if (maxCape > 1000) {
      this.add(rep, "Fırtına", 45, "warn",
        `Orta düzey oraj potansiyeli (CAPE ${Math.round(maxCape)} J/kg) — radar takibi önerilir`);
      rep.fuelExtraKg += f.type.fuelBurn * 0.12;
    }

    // --- Türbülans: jet çekirdeği ve rüzgâr kesmesi ---
    const maxWind = Math.max(...wx.map(w => w.wind));
    let maxShear = 0;
    for (let i = 1; i < comps.length; i++) maxShear = Math.max(maxShear, Math.abs(comps[i] - comps[i - 1]));
    if (maxWind > 180) this.add(rep, "Fırtına", Math.max(rep.categories["Fırtına"], 50), "warn",
      `Jet akımı çekirdeği (${Math.round(maxWind)} km/sa @${level} hPa) — açık hava türbülansı (CAT) riski, kemer ikazı planlandı`);
    else if (maxShear > 60) this.add(rep, "Fırtına", Math.max(rep.categories["Fırtına"], 35), "warn",
      `Rota boyunca belirgin rüzgâr kesmesi (Δ${Math.round(maxShear)} km/sa) — hafif/orta türbülans beklenir`);

    // --- Buzlanma (donma seviyesi vs seyir irtifası) ---
    const minFrz = Math.min(...wx.map(w => w.frz));
    if (f.type.cat === "turboprop" && cruiseAlt > minFrz && cruiseAlt < minFrz + 4500) {
      this.add(rep, "Buzlanma", 60, "warn",
        `Seyir irtifası (${cruiseAlt} m) buzlanma bandında (donma seviyesi ${Math.round(minFrz)} m) — anti-ice açık, yakıt +%3`);
      rep.fuelExtraKg += f.planFuel * 0.03;
    } else if (minFrz < 1500 && f.dest.lat > 45) {
      this.add(rep, "Buzlanma", 30, "info",
        `Varışta donma seviyesi düşük (${Math.round(minFrz)} m) — yerde buz çözme ihtimali`);
    }

    // --- Rüzgâr etkisi ve irtifa önerisi ---
    const tas = f.type.cruiseSpeed;
    const deltaMin = Math.round((f.routeDist / Math.max(tas + avgComp, 200) - f.routeDist / tas) * 60);
    if (avgComp < -40) {
      this.add(rep, "Rüzgâr", Math.min(85, -avgComp), "warn",
        `Ortalama karşı rüzgâr ${Math.round(-avgComp)} km/sa — blok süre +${deltaMin} dk`);
      rep.fuelExtraKg += Math.max(0, deltaMin / 60 * f.type.fuelBurn * 1.05);
    } else if (avgComp > 40) {
      this.add(rep, "Rüzgâr", 12, "info",
        `Arka rüzgâr avantajı ${Math.round(avgComp)} km/sa — ${-deltaMin} dk erken varış olası`);
    }
    if (avgComp2 - avgComp > 25) {
      const newAlt = GeoData.altOf(altLevel);
      if (Math.abs(newAlt - cruiseAlt) > 800 && newAlt < f.type.ceiling - 300) {
        rep.altSuggestion = newAlt;
        this.add(rep, "Rüzgâr", rep.categories["Rüzgâr"], "info",
          `İrtifa önerisi: ${newAlt} m (${altLevel} hPa) — rüzgâr ${Math.round(avgComp2 - avgComp)} km/sa daha uygun`);
      }
    }

    // --- Arazi / drift-down (GIS) ---
    if (direct.msa > f.type.seCeiling) {
      this.add(rep, "Arazi", 85, "alert",
        `MSA ${direct.msa} m > tek-motor tavanı ${f.type.seCeiling} m (${f.type.label}) — drift-down kaçış planı zorunlu`);
    } else if (direct.maxElev > 3000) {
      this.add(rep, "Arazi", 40, "warn",
        `Yüksek arazi: maks ${direct.maxElev} m (MSA ${direct.msa} m) — oksijen/kaçış prosedürü gözden geçirildi`);
    } else {
      rep.findings.push({ sev: "info", text: `Arazi profili uygun: maks ${direct.maxElev} m, MSA ${direct.msa} m` });
    }

    // --- Varış/kalkış meydanı gerçek tahmini ---
    const alt = nearestAirport(f.dest, [f.dest.code, f.origin.code]).airport;
    f.alternate = alt;
    const aptWx = await GeoData.airportWeather([f.origin, f.dest, alt], blockH);
    const dw = aptWx[1];
    if (dw.visM < 1000) {
      if (f.dest.cat3) this.add(rep, "Varış", 45, "warn",
        `${f.dest.code} görüş tahmini ${Math.round(dw.visM)} m — CAT III otoland planlandı`);
      else this.add(rep, "Varış", 80, "alert",
        `${f.dest.code} görüş tahmini ${Math.round(dw.visM)} m ve CAT III yok — divert riski yüksek, alternatif ${alt.code} hazır`);
      rep.fuelExtraKg += f.type.fuelBurn * 0.25;
    } else if (dw.visM < 3000) {
      this.add(rep, "Varış", 40, "warn", `${f.dest.code} görüş tahmini ${Math.round(dw.visM)} m — yaklaşma briefingi güncellendi`);
    }
    if (dw.gustKmh > 55) {
      this.add(rep, "Varış", Math.max(rep.categories["Varış"], 55), "warn",
        `${f.dest.code} hamle rüzgârı ${Math.round(dw.gustKmh)} km/sa — pas geçme olasılığı artmış, +10 dk yakıt`);
      rep.fuelExtraKg += f.type.fuelBurn * 0.17;
    }
    if (dw.precipMm > 3) this.add(rep, "Varış", Math.max(rep.categories["Varış"], 35), "warn",
      `${f.dest.code} kuvvetli yağış tahmini (${dw.precipMm.toFixed(1)} mm/sa) — ıslak pist performansı hesaplandı`);
    rep.findings.push({ sev: "info", text: `Alternatif meydan: ${alt.code} ${alt.name} (${Math.round(distKm(f.dest, alt))} km)` });

    // --- Rota varyantı seçimi (rüzgâr + hücre + arazi cezası) ---
    const cellsOn = pts => {
      let pen = 0;
      for (const c of this.sim.weather.cells)
        if (pts.some(p => distKm(p, c) < c.radius + 30)) pen += c.intensity * 6;
      return pen;
    };
    for (const v of variants) {
      v.cellPen = cellsOn(v.pts);
      v.terrainPen = v.msa > f.type.seCeiling ? 60 : 0;
      v.timeMin = v.dist / Math.max(tas + avgComp, 200) * 60;
      v.score = v.timeMin + v.cellPen + v.terrainPen;
    }
    const dirCells = direct.cellPen;
    if (dirCells > 0) this.add(rep, "Fırtına", Math.max(rep.categories["Fırtına"], 30 + dirCells), "warn",
      `Simülasyon meteo: direkt rotada aktif hücre kesişimi — tahmini +${dirCells} dk sapma`);
    const best = variants.reduce((a, b) => b.score < a.score ? b : a, variants[0]);
    if (best !== direct && direct.score - best.score >= 5) {
      rep.route = best.name;
      rep.routeVia = best.via;
      rep.savingMin = Math.round(direct.score - best.score);
      const why = best.cellPen < dirCells ? "fırtına hücrelerinden kaçınma"
        : best.terrainPen < direct.terrainPen ? "arazi riskini azaltma" : "rüzgâr optimizasyonu";
      rep.findings.push({ sev: "info", text: `Rota önerisi: ${best.name} (~${rep.savingMin} dk kazanç, ${why})` });
    }
  }

  // ---- Çevrimdışı: sentetik modelle aynı rapor iskeleti ----
  _analyzeSynthetic(f, rep) {
    const n = 12, pts = samplePath(f.origin, null, f.dest, n);
    let cellPen = 0, worst = null;
    for (const c of this.sim.weather.cells) {
      if (pts.some(p => distKm(p, c) < c.radius + 30)) {
        cellPen += c.intensity * 6;
        if (!worst || c.intensity > worst.intensity) worst = c;
      }
    }
    if (worst) this.add(rep, "Fırtına", 30 + cellPen, "warn",
      `Rotada ${worst.label.toLowerCase()} (şiddet ${worst.intensity}/3) — tahmini +${cellPen} dk sapma`);
    const comps = pts.map((p, i) =>
      windComponent(p, bearing(pts[Math.max(0, i - 1)], pts[Math.min(n, i + 1)])));
    const avgComp = comps.reduce((s, x) => s + x, 0) / comps.length;
    rep.wind = { avgComp: Math.round(avgComp), samples: comps.map(c => Math.round(c)), level: "model" };
    if (avgComp < -40) this.add(rep, "Rüzgâr", Math.min(80, -avgComp), "warn",
      `Model karşı rüzgârı ${Math.round(-avgComp)} km/sa — ek yakıt önerildi`);
    if (avgComp < -20) rep.fuelExtraKg += f.type.fuelBurn * 0.15;
    f.alternate = nearestAirport(f.dest, [f.dest.code, f.origin.code]).airport;
    rep.findings.push({ sev: "info", text: `Alternatif meydan: ${f.alternate.code} (${Math.round(distKm(f.dest, f.alternate))} km)` });
    rep.terrain = null;
  }

  // ---- Veri kaynağından bağımsız kontroller ----
  _commonChecks(f, rep) {
    const margin = f.routeDist / f.type.range;
    if (margin > 0.85) this.add(rep, "Uçak", 55, "warn",
      `Menzil kullanımı %${Math.round(margin * 100)} — yakıt planı sıkı, alternatif seçenekleri sınırlı`);
    const maint = this.maintenanceRisk(f.aircraft);
    if (maint >= 60) this.add(rep, "Uçak", maint, "warn",
      `${f.aircraft.reg} bakım risk skoru ${maint}/100 — uçuş öncesi genişletilmiş kontrol yapıldı`);
    const wx = this.sim.weather.wx(f.origin.code);
    if (wx.visM < 600 && !f.origin.cat3) this.add(rep, "Varış", Math.max(rep.categories["Varış"], 50), "warn",
      `Kalkış meydanı ${f.origin.code} düşük görüş (${wx.visM} m) — kalkış rötarı olası`);
  }

  // ---- Önerileri uygula (uçak hâlâ yerdeyse) ----
  _apply(f, rep) {
    if (!["SCHEDULED", "BOARDING"].includes(f.phase)) return;
    if (rep.fuelExtraKg > 100) {
      const extra = Math.min(Math.round(rep.fuelExtraKg), f.type.fuelCap - Math.round(f.planFuel));
      if (extra > 0) {
        f.fuel += extra; f.planFuel += extra;
        rep.applied.push(`+${extra} kg yakıt`);
      }
    }
    if (rep.routeVia && f.setVia(rep.routeVia)) {
      rep.applied.push(`${rep.route} (~${rep.savingMin} dk)`);
    }
    if (rep.altSuggestion) {
      f.cruiseAltOverride = rep.altSuggestion;
      rep.applied.push(`seyir ${rep.altSuggestion} m`);
    }
    if (rep.applied.length) {
      f.log(`AI önerileri uygulandı: ${rep.applied.join(" · ")}`, "ok");
    }
  }
}
