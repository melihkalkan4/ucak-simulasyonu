// ============================================================
// Uçuş yaşam döngüsü: faz makinesi, yakıt, hava/teknik olaylar
// ============================================================

const PHASE_LABELS = {
  SCHEDULED: "Planlandı",  BOARDING: "Biniş",       TAXI_OUT: "Taksi (çıkış)",
  TAKEOFF: "Kalkış",       CLIMB: "Tırmanış",       CRUISE: "Seyir",
  DESCENT: "Alçalma",      HOLDING: "Bekleme paterni", APPROACH: "Yaklaşma",
  LANDING: "İniş",         TAXI_IN: "Taksi (varış)", ARRIVED: "Tamamlandı",
  DIVERTED: "Divert",      CANCELLED: "İptal",
};

const AIRBORNE = new Set(["TAKEOFF", "CLIMB", "CRUISE", "DESCENT", "HOLDING", "APPROACH", "LANDING"]);
const DONE = new Set(["ARRIVED", "DIVERTED", "CANCELLED"]);

class Flight {
  constructor(sim, aircraft, origin, dest, depTime, number) {
    this.sim = sim;
    this.aircraft = aircraft;
    this.type = AIRCRAFT_TYPES[aircraft.type];
    this.origin = origin;
    this.dest = dest;
    this.number = `${AIRLINE.iata}${number}`;

    this.routeFrom = origin;          // divert olursa değişir
    this.routeTo = dest;
    this.routeDist = distKm(origin, dest);
    this.distFlown = 0;

    this.schedDep = depTime;
    const estMin = (this.routeDist / (this.type.cruiseSpeed * 0.82)) * 60 + 30;
    this.schedArr = depTime + Math.round(estMin);
    this.taxiOutMin = 9 + Math.random() * 7;

    this.pax = Math.round(this.type.pax * (0.68 + Math.random() * 0.30));
    // Yakıt planı: sefer + %5 + alternatif (30 dk) + rezerv (45 dk)
    const tripFuel = this.type.fuelBurn * (this.routeDist / (this.type.cruiseSpeed * 0.85));
    this.reserveFuel = this.type.fuelBurn * 0.75;
    this.planFuel = Math.min(this.type.fuelCap,
      tripFuel * 1.05 + this.type.fuelBurn * 0.5 + this.reserveFuel);
    this.fuel = this.planFuel;
    this.fuelUsed = 0;

    this.phase = "SCHEDULED";
    this.pos = { lat: origin.lat, lon: origin.lon };
    this.alt = 0;
    this.gs = 0;
    this.hdg = bearing(origin, dest);

    this.depDelay = 0;          // kalkış öncesi birikmiş rötar (dk)
    this.airDelay = 0;          // havada birikmiş gecikme (dk)
    this.actualDep = null;
    this.actualArr = null;
    this.holdingMin = 0;
    this.phaseTimer = 0;
    this.diverted = false;
    this.divertReason = null;
    this.majorEvent = false;    // uçuş başına en fazla bir büyük olay
    this.goneAround = false;
    this.handledCells = new Set();
    this.lowVisWarned = false;
    this.events = [];           // bu uçuşa ait günlük satırları
  }

  log(msg, level = "info") {
    this.events.push({ t: this.sim.t, msg, level });
    this.sim.addLog(`${this.number} ${this.origin.code}→${this.dest.code} · ${msg}`, level);
  }

  remaining() { return Math.max(0, this.routeDist - this.distFlown); }

  burn(dt, factor) {
    const kg = this.type.fuelBurn * factor * dt / 60;
    this.fuel -= kg;
    this.fuelUsed += kg;
  }

  // dt dakika boyunca rota üzerinde ilerle
  moveAlong(dt, speedFactor) {
    const tas = this.type.cruiseSpeed * speedFactor;
    const wind = this.alt > 6000 ? windComponent(this.pos, this.hdg) : 0;
    this.gs = Math.max(120, tas + wind);
    this.distFlown = Math.min(this.routeDist, this.distFlown + this.gs * dt / 60);
    const f = this.routeDist > 0 ? this.distFlown / this.routeDist : 1;
    this.pos = gcPoint(this.routeFrom, this.routeTo, f);
    const ahead = gcPoint(this.routeFrom, this.routeTo, Math.min(1, f + 0.01));
    this.hdg = bearing(this.pos, ahead);
  }

  // ---- Divert: rotayı mevcut konumdan yeni meydana çevir ----
  beginDivert(airport, reason, level = "warn") {
    this.diverted = true;
    this.divertReason = reason;
    this.routeFrom = { lat: this.pos.lat, lon: this.pos.lon };
    this.routeTo = airport;
    this.routeDist = distKm(this.routeFrom, airport);
    this.distFlown = 0;
    this.divertAirport = airport;
    this.phase = "CRUISE";
    this.log(`${reason} — ${airport.code} ${airport.name} meydanına yönlendirildi`, level);
  }

  effectiveDest() { return this.diverted ? this.divertAirport : this.dest; }

  descentDist() { return this.cruiseAltFor() * 0.0185 + 30; } // ~3° süzülüş + yaklaşma payı

  cruiseAltFor() {
    // kısa bacaklarda daha alçak seyir
    const cap = this.routeDist < 400 ? 8000 : this.type.cruiseAlt;
    return Math.min(cap, this.type.cruiseAlt);
  }

  // ============================ ANA GÜNCELLEME ============================
  update(dt) {
    const t = this.sim.t;
    switch (this.phase) {

      case "SCHEDULED":
        if (t >= this.schedDep - 35) {
          this.phase = "BOARDING";
          this.log(`biniş başladı (${this.pax} yolcu, planlanan kalkış ${this.sim.fmtTime(this.schedDep)})`);
          // Kalkış öncesi teknik kontrol
          const r = Math.random();
          if (r < 0.005) {
            this.cancel("teknik arıza nedeniyle sefer iptal edildi", 150);
          } else if (r < 0.05) {
            this.depDelay += Math.round(20 + Math.random() * 70);
            this.log(`teknik kontrol: kalkış ${this.depDelay} dk rötarlı`, "warn");
          }
        }
        break;

      case "BOARDING":
        if (t >= this.schedDep + this.depDelay) {
          // Kalkış meydanı görüş kontrolü
          const wx = this.sim.weather.wx(this.origin.code);
          if (wx.visM < 350 && !this.origin.cat3) {
            this.depDelay += dt;
            if (!this.lowVisWarned) {
              this.lowVisWarned = true;
              this.log(`${this.origin.code} görüş ${wx.visM} m — düşük görüş, kalkış beklemede`, "warn");
            }
            if (this.depDelay > 160) this.cancel("görüş açılmadı, sefer iptal edildi", 60);
          } else {
            this.phase = "TAXI_OUT";
            this.actualDep = t;
            this.log("kapıdan ayrıldı, piste taksi yapıyor");
          }
        }
        break;

      case "TAXI_OUT":
        this.burn(dt, 0.12);
        if (t >= this.actualDep + this.taxiOutMin) {
          this.phase = "TAKEOFF";
          this.phaseTimer = 0;
          this.log(`pist başında — kalkış (${this.type.label})`);
          if (Math.random() < 0.006) {
            this.log("kalkışta kuş çarpması! Motor göstergeleri kontrol ediliyor", "alert");
            if (Math.random() < 0.5) {
              this.birdReturn = true; // tırmanışta meydana geri dönecek
            } else {
              this.log("göstergeler normal, uçuşa devam ediliyor", "ok");
              this.aircraft.needsCheck = true;
            }
          }
        }
        break;

      case "TAKEOFF":
        this.phaseTimer += dt;
        this.burn(dt, 1.3);
        this.alt = Math.min(800, this.alt + 500 * dt);
        if (this.phaseTimer >= 2) { this.phase = "CLIMB"; }
        break;

      case "CLIMB": {
        this.burn(dt, 1.15);
        this.alt = Math.min(this.cruiseAltFor(), this.alt + this.type.climbRate * dt);
        this.moveAlong(dt, 0.72);
        if (this.birdReturn && this.alt > 2000) {
          this.birdReturn = false;
          this.majorEvent = true;
          this.aircraft.needsCheck = true;
          this.beginDivert(this.origin, "kuş çarpması sonrası ihtiyati geri dönüş", "alert");
          break;
        }
        if (this.alt >= this.cruiseAltFor()) {
          this.phase = "CRUISE";
          this.log(`seyir irtifasına ulaştı: ${Math.round(this.alt / 100) * 100} m`);
        }
        // kısa bacaklarda tırmanış bitmeden alçalma başlayabilir
        if (this.remaining() <= this.descentDist()) this.phase = "DESCENT";
        break;
      }

      case "CRUISE":
        this.burn(dt, 1.0);
        this.moveAlong(dt, 1.0);
        this.checkWeatherAhead();
        this.checkRandomEvents(dt);
        if (this.remaining() <= this.descentDist()) {
          this.phase = "DESCENT";
          this.log(`alçalmaya başladı — ${this.effectiveDest().code} ${Math.round(this.remaining())} km`);
        }
        break;

      case "DESCENT": {
        this.burn(dt, 0.5);
        this.moveAlong(dt, 0.85);
        const dd = this.descentDist();
        this.alt = Math.max(1000, this.cruiseAltFor() * Math.min(1, this.remaining() / Math.max(dd, 1)));
        if (this.remaining() <= 45) {
          // Varış meydanı uygun mu?
          const dest = this.effectiveDest();
          const wx = this.sim.weather.wx(dest.code);
          const storm = this.sim.weather.cellAt(dest, 40);
          const lowVis = wx.visM < 400 && !dest.cat3;
          if ((lowVis || (storm && storm.intensity >= 3)) && !this.diverted) {
            this.phase = "HOLDING";
            this.holdingMin = 0;
            const why = lowVis ? `görüş ${wx.visM} m` : "meydan üzerinde şiddetli oraj";
            this.log(`${dest.code} müsait değil (${why}) — bekleme paternine girildi`, "warn");
          } else {
            this.phase = "APPROACH";
            this.log(`son yaklaşmada (rüzgâr ${wx.windKt} kt)`);
          }
        }
        break;
      }

      case "HOLDING": {
        this.burn(dt, 0.85);
        this.holdingMin += dt;
        this.airDelay += dt;
        this.alt = 3500;
        const dest = this.effectiveDest();
        // her ~10 dakikada bir hava düzelebilir
        if (Math.random() < dt / 10 * 0.35) {
          this.sim.weather.improve(dest.code);
          this.log(`${dest.code} havası düzeldi — yaklaşma müsaadesi alındı`, "ok");
          this.phase = "APPROACH";
          break;
        }
        const fuelLow = this.fuel < this.reserveFuel + this.type.fuelBurn * 0.5;
        if (this.holdingMin > 45 || fuelLow) {
          const alt = nearestAirport(this.pos, [dest.code]).airport;
          this.majorEvent = true;
          if (fuelLow) this.log("yakıt asgari seviyeye yaklaşıyor (MINIMUM FUEL)", "alert");
          this.beginDivert(alt, "bekleme limiti aşıldı", "warn");
        }
        break;
      }

      case "APPROACH": {
        this.burn(dt, 0.45);
        this.moveAlong(dt, 0.35);
        this.alt = Math.max(200, 2500 * this.remaining() / 45);
        if (this.remaining() <= 1) {
          const wx = this.sim.weather.wx(this.effectiveDest().code);
          // pas geçme: kuvvetli rüzgârda daha olası
          const goProb = wx.windKt > 32 ? 0.30 : wx.windKt > 24 ? 0.10 : 0.015;
          if (!this.goneAround && Math.random() < goProb) {
            this.goneAround = true;
            this.airDelay += 12;
            this.distFlown = Math.max(0, this.routeDist - 30);
            this.burn(1, 1.2);
            this.log(`pas geçti! (rüzgâr ${wx.windKt} kt) — yeniden yaklaşma`, "warn");
          } else {
            this.phase = "LANDING";
            this.phaseTimer = 0;
            if (Math.random() < 0.004) {
              this.log("yaklaşmada kuş çarpması — iniş normal tamamlanıyor, uçak kontrole alınacak", "warn");
              this.aircraft.needsCheck = true;
            }
          }
        }
        break;
      }

      case "LANDING":
        this.phaseTimer += dt;
        this.alt = 0;
        this.gs = 60;
        if (this.phaseTimer >= 2) {
          this.phase = "TAXI_IN";
          this.phaseTimer = 0;
          this.log(`${this.effectiveDest().code} pistine indi`);
        }
        break;

      case "TAXI_IN":
        this.phaseTimer += dt;
        this.burn(dt, 0.1);
        if (this.phaseTimer >= 6) this.complete();
        break;
    }

    // Havadayken genel yakıt güvenliği
    if (AIRBORNE.has(this.phase) && this.fuel < this.reserveFuel && !this.fuelEmergency) {
      this.fuelEmergency = true;
      this.log("MAYDAY FUEL — öncelikli iniş talep edildi", "alert");
      if (this.phase === "HOLDING") this.phase = "APPROACH";
    }
  }

  // ---- Rota önündeki hava hücreleri ----
  checkWeatherAhead() {
    const f = this.routeDist > 0 ? this.distFlown / this.routeDist : 1;
    const lookAhead = gcPoint(this.routeFrom, this.routeTo,
      Math.min(1, f + 130 / Math.max(this.routeDist, 1)));
    const cell = this.sim.weather.cellAt(lookAhead, 20);
    if (!cell || this.handledCells.has(cell.id)) return;
    this.handledCells.add(cell.id);

    const canTopIt = this.type.ceiling > cell.top + 400 && cell.intensity < 3;
    if (cell.kind === "ICE" && this.alt > cell.top) return; // buzlanma altımızda

    if (canTopIt && this.type.cat !== "turboprop") {
      this.log(`rotada ${cell.label.toLowerCase()} — üzerinden aşılıyor (tavan ${Math.round(cell.top)} m)`);
      this.airDelay += 2;
      this.burn(2, 1.1);
    } else if (cell.intensity >= 2) {
      const extra = Math.round(6 + Math.random() * 12);
      this.airDelay += extra;
      this.distFlown = Math.max(0, this.distFlown - extra * this.gs / 60 * 0.3);
      this.burn(extra * 0.6, 1.0);
      this.log(`rotada ${cell.label.toLowerCase()} (şiddet ${cell.intensity}/3) — ${extra} dk sapma`, "warn");
      if (cell.intensity === 3 && Math.random() < 0.2) {
        this.log("şiddetli türbülans! Kemer ikazı, kabin servisi durduruldu", "alert");
        if (Math.random() < 0.25) {
          this.log("türbülansta 1 kabin görevlisi hafif yaralandı — varışta sağlık ekibi hazır", "alert");
        }
      }
    } else {
      this.log(`hafif ${cell.label.toLowerCase()} geçiliyor — kemer ikazı açık`);
    }
  }

  // ---- Rastgele uçuş olayları (seyirde) ----
  checkRandomEvents(dt) {
    if (this.majorEvent) return;
    const roll = Math.random();
    const paxF = this.pax / 180;

    if (roll < 0.00005 * dt * paxF) {
      this.majorEvent = true;
      this.log("kabinde tıbbi acil durum — yolcuya müdahale ediliyor", "alert");
      if (this.remaining() > 600) {
        const alt = nearestAirport(this.pos, []).airport;
        if (alt.code !== this.effectiveDest().code) {
          this.beginDivert(alt, "tıbbi acil durum", "alert");
        }
      } else {
        this.log("varış yakın — öncelikli iniş koordine edildi, ambulans hazır", "warn");
        this.airDelay -= 3;
      }
    } else if (roll < 0.00005 * dt * paxF + 0.000014 * dt) {
      this.majorEvent = true;
      this.aircraft.needsCheck = true;
      this.log("motorda anormal titreşim — motor rölantiye alındı (PAN PAN)", "alert");
      const alt = nearestAirport(this.pos, []).airport;
      this.alt = Math.min(this.alt, 8000);
      this.beginDivert(alt, "motor arızası", "alert");
    } else if (roll < 0.00005 * dt * paxF + 0.000014 * dt + 0.00001 * dt) {
      this.majorEvent = true;
      this.aircraft.needsCheck = true;
      this.log("MAYDAY — kabin basıncı düşüyor, acil alçalma!", "alert");
      this.alt = 3000;
      const alt = nearestAirport(this.pos, []).airport;
      this.beginDivert(alt, "kabin basıncı kaybı", "alert");
    } else if (roll > 1 - 0.00002 * dt) {
      this.log("küçük hidrolik sistem uyarısı — uçuş normal, varışta bakım kontrolü yapılacak", "warn");
      this.aircraft.needsCheck = true;
    }
  }

  cancel(reason, groundTime) {
    this.phase = "CANCELLED";
    this.log(reason, "alert");
    this.sim.stats.cancelled++;
    this.aircraft.activeFlight = null;
    this.aircraft.status = "Bakımda";
    this.aircraft.readyAt = this.sim.t + groundTime;
  }

  complete() {
    this.actualArr = this.sim.t;
    const dest = this.effectiveDest();
    if (this.diverted) {
      this.phase = "DIVERTED";
      this.sim.stats.diverted++;
      this.log(`${dest.code} kapısına yanaştı — yolcular için aktarma düzenleniyor (${this.divertReason})`, "warn");
    } else {
      this.phase = "ARRIVED";
      const delay = Math.round(this.actualArr - this.schedArr);
      this.arrDelay = delay;
      this.sim.stats.completed++;
      this.sim.stats.pax += this.pax;
      if (delay <= 15) this.sim.stats.onTime++;
      this.sim.stats.revenue += this.pax * distKm(this.origin, this.dest) * 0.07;
      const dTxt = delay > 15 ? `${delay} dk rötarlı` : delay < -5 ? `${-delay} dk erken` : "zamanında";
      this.log(`kapıya yanaştı — ${dTxt}`, delay > 15 ? "warn" : "ok");
    }
    this.sim.stats.fuelKg += this.fuelUsed;
    this.sim.stats.cost += this.fuelUsed * 0.85;
    // uçağı serbest bırak
    const ac = this.aircraft;
    ac.location = dest.code;
    ac.activeFlight = null;
    ac.hoursFlown += (this.actualArr - this.actualDep) / 60;
    let ground = this.type.turnaround + (this.diverted ? 60 : 0);
    if (ac.needsCheck) {
      ground += 90;
      ac.needsCheck = false;
      this.sim.addLog(`${ac.reg} ${dest.code}'de bakım kontrolüne alındı (+90 dk)`, "warn");
    }
    ac.readyAt = this.sim.t + ground;
    ac.status = "Yerde";
  }
}
