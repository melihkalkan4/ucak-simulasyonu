// ============================================================
// Simülasyon motoru: saat, tarifeleme, filo rotasyonu, istatistik
// ============================================================

class Simulation {
  constructor() {
    this.t = 5 * 60 + 30;           // 1. gün 05:30 (dakika)
    this.minPerSec = 5;             // hız: sim dakikası / gerçek saniye
    this.weather = new WeatherSystem();
    this.flights = [];              // aktif + yakın geçmiş
    this.logEntries = [];
    this.flightNo = 100;
    this.stats = {
      completed: 0, onTime: 0, diverted: 0, cancelled: 0,
      pax: 0, revenue: 0, cost: 0, fuelKg: 0,
    };
    this.fleet = FLEET_PLAN.map(p => ({
      ...p,
      typeData: AIRCRAFT_TYPES[p.type],
      location: p.hub,
      status: "Yerde",
      readyAt: this.t + Math.random() * 90,   // kademeli sabah başlangıcı
      activeFlight: null,
      needsCheck: false,
      hoursFlown: 0,
    }));
    this.weather.init(this.t);
    this.addLog(`${AIRLINE.name} Uçuş Operasyon Merkezi açıldı — ${this.fleet.length} uçak hizmette`, "ok");
  }

  fmtTime(t) {
    const day = Math.floor(t / 1440) + 1;
    const hh = String(Math.floor((t % 1440) / 60)).padStart(2, "0");
    const mm = String(Math.floor(t % 60)).padStart(2, "0");
    return `${day}. gün ${hh}:${mm}`;
  }

  addLog(msg, level = "info") {
    this.logEntries.push({ t: this.t, msg, level });
    if (this.logEntries.length > 250) this.logEntries.splice(0, 50);
  }

  // ---- Uygun varış meydanı seç ----
  pickDestination(ac) {
    const here = AIRPORTS[ac.location];
    const tp = ac.typeData;
    // üs dışındaysa ve üsse dönebiliyorsa: dön
    if (ac.location !== ac.hub) {
      const hub = AIRPORTS[ac.hub];
      if (distKm(here, hub) < tp.range * 0.92) return hub;
    }
    const minD = tp.minDist || 250;
    const maxD = Math.min(tp.maxDist || 1e9, tp.range * 0.92);
    const cands = Object.values(AIRPORTS).filter(a => {
      if (a.code === ac.location) return false;
      const d = distKm(here, a);
      return d >= minD && d <= maxD;
    });
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  scheduler() {
    for (const ac of this.fleet) {
      if (ac.activeFlight || this.t < ac.readyAt) continue;
      const dest = this.pickDestination(ac);
      if (!dest) { ac.readyAt = this.t + 60; continue; }
      const origin = AIRPORTS[ac.location];
      const dep = this.t + 45;      // 45 dk sonra kalkışa planla
      this.flightNo += 1 + Math.floor(Math.random() * 3);
      const fl = new Flight(this, ac, origin, dest, dep, this.flightNo);
      ac.activeFlight = fl;
      ac.status = "Görevde";
      this.flights.push(fl);
      this.addLog(`${fl.number} tarifeye eklendi: ${origin.code}→${dest.code} · ${ac.reg} (${fl.type.label}) · kalkış ${this.fmtTime(dep)}`);
    }
    // biten uçuşları temizle (son 12'yi geçmiş olarak tut)
    const done = this.flights.filter(f => DONE.has(f.phase));
    if (done.length > 12) {
      const drop = new Set(done.slice(0, done.length - 12));
      this.flights = this.flights.filter(f => !drop.has(f));
    }
  }

  tick(realDtSec) {
    if (this.minPerSec === 0) return;
    let dt = this.minPerSec * realDtSec;   // sim dakikası
    dt = Math.min(dt, 6);                  // kararlılık için adım sınırı
    this.t += dt;
    this.weather.update(this.t, dt);
    this.scheduler();
    for (const f of this.flights) {
      if (!DONE.has(f.phase)) f.update(dt);
    }
  }
}
