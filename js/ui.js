// ============================================================
// Arayüz: canvas harita + paneller + operasyon günlüğü
// ============================================================

const MAP = { lonMin: -100, lonMax: 152, latMin: -46, latMax: 68 };

class UI {
  constructor(sim) {
    this.sim = sim;
    this.canvas = document.getElementById("map");
    this.ctx = this.canvas.getContext("2d");
    this.selected = null;
    this.planeScreenPos = [];   // tıklama algılama için
    this.elFlights = document.getElementById("flight-list");
    this.elFleet = document.getElementById("fleet-list");
    this.elDetail = document.getElementById("detail-body");
    this.elLog = document.getElementById("log");
    this.elClock = document.getElementById("clock");
    this.elStats = document.getElementById("stats");
    this.lastLogLen = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("click", e => this.onClick(e));
  }

  resize() {
    const wrap = this.canvas.parentElement;
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
  }

  px(pos) {
    return {
      x: (pos.lon - MAP.lonMin) / (MAP.lonMax - MAP.lonMin) * this.canvas.width,
      y: (MAP.latMax - pos.lat) / (MAP.latMax - MAP.latMin) * this.canvas.height,
    };
  }

  kmToPx(km, lat) {
    const degLon = km / (111.32 * Math.max(0.3, Math.cos(rad(lat))));
    return degLon / (MAP.lonMax - MAP.lonMin) * this.canvas.width;
  }

  onClick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bestD = 18;
    for (const p of this.planeScreenPos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p.flight; }
    }
    this.selected = best;
    this.render();
  }

  render() {
    this.drawMap();
    this.renderFlightList();
    this.renderFleet();
    this.renderDetail();
    this.renderLog();
    this.elClock.textContent = this.sim.fmtTime(this.sim.t);
    const s = this.sim.stats;
    const otp = s.completed ? Math.round(100 * s.onTime / s.completed) : 100;
    this.elStats.innerHTML =
      `<span>Uçuş <b>${s.completed}</b></span>` +
      `<span>Zamanında <b>%${otp}</b></span>` +
      `<span>Divert <b>${s.diverted}</b></span>` +
      `<span>İptal <b>${s.cancelled}</b></span>` +
      `<span>Yolcu <b>${s.pax.toLocaleString("tr-TR")}</b></span>` +
      `<span>Gelir <b>$${(s.revenue / 1000).toFixed(0)}k</b></span>` +
      `<span>Yakıt <b>${(s.fuelKg / 1000).toFixed(1)} t</b></span>`;
  }

  // ============================ HARİTA ============================
  drawMap() {
    const wrap = this.canvas.parentElement;
    if (this.canvas.width !== wrap.clientWidth || this.canvas.height !== wrap.clientHeight) this.resize();
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, W, H);

    // graticule
    ctx.strokeStyle = "rgba(80,120,170,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -90; lon <= 150; lon += 15) {
      const p = this.px({ lat: 0, lon });
      ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H);
    }
    for (let lat = -45; lat <= 60; lat += 15) {
      const p = this.px({ lat, lon: 0 });
      ctx.moveTo(0, p.y); ctx.lineTo(W, p.y);
    }
    ctx.stroke();
    // ekvator vurgusu
    ctx.strokeStyle = "rgba(80,120,170,0.25)";
    const eq = this.px({ lat: 0, lon: 0 });
    ctx.beginPath(); ctx.moveTo(0, eq.y); ctx.lineTo(W, eq.y); ctx.stroke();

    // hava hücreleri
    for (const c of this.sim.weather.cells) {
      const p = this.px(c);
      const rPx = this.kmToPx(c.radius, c.lat);
      const colors = {
        TS:   ["rgba(220,60,60,", "#e05555"],
        TURB: ["rgba(230,160,50,", "#e0a040"],
        ICE:  ["rgba(90,170,230,", "#5aaae0"],
      }[c.kind];
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rPx);
      g.addColorStop(0, colors[0] + (0.10 + c.intensity * 0.07) + ")");
      g.addColorStop(1, colors[0] + "0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colors[0] + "0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors[1];
      ctx.font = "9px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${c.kind} ${c.intensity}`, p.x, p.y - rPx - 3);
    }

    // havalimanları
    ctx.font = "10px 'Segoe UI', sans-serif";
    for (const ap of Object.values(AIRPORTS)) {
      const p = this.px(ap);
      const wx = this.sim.weather.wx(ap.code);
      const bad = wx.visM < 1000;
      ctx.fillStyle = bad ? "#e0a040" : "#4d6a8f";
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bad ? "#e0a040" : "#7d9bbf";
      ctx.textAlign = "left";
      ctx.fillText(ap.code + (bad ? " ≋" : ""), p.x + 5, p.y + 3);
    }

    // uçuşlar
    this.planeScreenPos = [];
    for (const f of this.sim.flights) {
      if (!AIRBORNE.has(f.phase)) continue;
      const p = this.px(f.pos);
      this.planeScreenPos.push({ x: p.x, y: p.y, flight: f });
      const sel = f === this.selected;

      // rota çizgisi
      if (sel) {
        ctx.strokeStyle = "rgba(90,200,250,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const q = this.px(gcPoint(f.routeFrom, f.routeTo, i / 40));
          i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // uçak üçgeni (rotaya döndürülmüş)
      const color = f.diverted || f.fuelEmergency ? "#e05555" :
                    f.phase === "HOLDING" ? "#e0a040" :
                    sel ? "#5ac8fa" : "#d7e6f5";
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rad(f.hdg));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      if (sel) {
        ctx.strokeStyle = "rgba(90,200,250,0.8)";
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(f.number, p.x + 9, p.y - 6);
    }
  }

  // ============================ PANELLER ============================
  renderFlightList() {
    const active = this.sim.flights.filter(f => !DONE.has(f.phase));
    const recent = this.sim.flights.filter(f => DONE.has(f.phase)).slice(-6).reverse();
    let html = "";
    for (const f of active) {
      const sel = f === this.selected ? " sel" : "";
      const cls = f.diverted ? " bad" : f.phase === "HOLDING" ? " warn" : "";
      html += `<div class="fl-item${sel}${cls}" data-no="${f.number}">
        <div class="fl-top"><b>${f.number}</b><span>${f.origin.code} → ${f.dest.code}</span></div>
        <div class="fl-sub">${f.aircraft.reg} · ${PHASE_LABELS[f.phase]}${AIRBORNE.has(f.phase) ? " · " + Math.round(f.remaining()) + " km" : ""}</div>
      </div>`;
    }
    if (recent.length) {
      html += `<div class="list-sep">Son tamamlananlar</div>`;
      for (const f of recent) {
        const cls = f.phase === "ARRIVED" ? "ok" : "bad";
        html += `<div class="fl-item done"><div class="fl-top"><b>${f.number}</b>
          <span class="${cls}">${PHASE_LABELS[f.phase]}</span></div>
          <div class="fl-sub">${f.origin.code} → ${f.dest.code}</div></div>`;
      }
    }
    this.elFlights.innerHTML = html || "<div class='empty'>Uçuş yok</div>";
    this.elFlights.querySelectorAll(".fl-item[data-no]").forEach(el => {
      el.onclick = () => {
        this.selected = this.sim.flights.find(f => f.number === el.dataset.no) || null;
        this.render();
      };
    });
  }

  renderFleet() {
    let html = "";
    for (const ac of this.sim.fleet) {
      const fl = ac.activeFlight;
      const st = fl ? `${fl.number} · ${PHASE_LABELS[fl.phase]}` :
        this.sim.t < ac.readyAt ? `${ac.status} · ${Math.max(0, Math.round(ac.readyAt - this.sim.t))} dk sonra hazır` : "Hazır";
      html += `<div class="ac-item">
        <div class="fl-top"><b>${ac.reg}</b><span>${ac.location}</span></div>
        <div class="fl-sub">${ac.typeData.label} · ${st}</div></div>`;
    }
    this.elFleet.innerHTML = html;
  }

  renderDetail() {
    const f = this.selected;
    if (!f) { this.elDetail.innerHTML = "Haritadan veya listeden bir uçuş seçin…"; return; }
    const rows = [
      ["Sefer", `${f.number} · ${f.origin.code} ${f.origin.name} → ${f.dest.code} ${f.dest.name}`],
      ["Uçak", `${f.aircraft.reg} · ${f.type.label}`],
      ["Durum", PHASE_LABELS[f.phase] + (f.diverted ? ` → ${f.divertAirport.code} (${f.divertReason})` : "")],
      ["Yolcu", `${f.pax}`],
      ["İrtifa", `${Math.round(f.alt).toLocaleString("tr-TR")} m`],
      ["Yer hızı", `${Math.round(f.gs)} km/sa`],
      ["Kalan", `${Math.round(f.remaining())} km`],
      ["Yakıt", `${Math.max(0, Math.round(f.fuel)).toLocaleString("tr-TR")} / ${Math.round(f.planFuel).toLocaleString("tr-TR")} kg`],
      ["Plan kalkış", this.sim.fmtTime(f.schedDep)],
      ["Plan varış", this.sim.fmtTime(f.schedArr)],
      ["Gecikme", `${Math.round(f.depDelay + f.airDelay)} dk`],
    ];
    let html = "<table>";
    for (const [k, v] of rows) html += `<tr><td>${k}</td><td>${v}</td></tr>`;
    html += "</table><div class='fl-events'>";
    for (const e of f.events.slice(-8).reverse()) {
      html += `<div class="log-line ${e.level}"><span>${this.sim.fmtTime(e.t)}</span> ${e.msg}</div>`;
    }
    html += "</div>";
    this.elDetail.innerHTML = html;
  }

  renderLog() {
    if (this.sim.logEntries.length === this.lastLogLen) return;
    this.lastLogLen = this.sim.logEntries.length;
    let html = "";
    for (const e of this.sim.logEntries.slice(-90).reverse()) {
      html += `<div class="log-line ${e.level}"><span>${this.sim.fmtTime(e.t)}</span> ${e.msg}</div>`;
    }
    this.elLog.innerHTML = html;
  }
}
