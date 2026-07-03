// ============================================================
// Başlatma ve ana döngü
// ============================================================

const sim = new Simulation();
const ui = new UI(sim);

// ?ff=<dakika> ile simülasyonu ileri sar (ör. tanıtım görselleri için)
const ffMin = Number(new URLSearchParams(location.search).get("ff")) || 0;
for (let done = 0; done < ffMin; done += 6) sim.tick(6 / sim.minPerSec);

// hız düğmeleri
document.querySelectorAll(".speed-controls button").forEach(btn => {
  btn.addEventListener("click", () => {
    sim.minPerSec = Number(btn.dataset.speed);
    document.querySelectorAll(".speed-controls button")
      .forEach(b => b.classList.toggle("active", b === btn));
  });
});

const TICK_MS = 200;
setInterval(() => {
  sim.tick(TICK_MS / 1000);
  ui.render();
}, TICK_MS);

ui.render();
