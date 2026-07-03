// ============================================================
// Coğrafi yardımcılar — büyük daire hesapları
// ============================================================

const R_EARTH = 6371; // km
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

// Haversine mesafesi (km)
function distKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

// Büyük daire üzerinde f (0..1) oranındaki nokta
function gcPoint(a, b, f) {
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
}

// a'dan b'ye başlangıç rotası (derece, 0=Kuzey)
function bearing(a, b) {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Verilen konuma en yakın havalimanı (hariç tutulanlar dışında)
function nearestAirport(pos, exclude = []) {
  let best = null, bestD = Infinity;
  for (const ap of Object.values(AIRPORTS)) {
    if (exclude.includes(ap.code)) continue;
    const d = distKm(pos, ap);
    if (d < bestD) { bestD = d; best = ap; }
  }
  return { airport: best, dist: bestD };
}

// Kuzey yarımküre jet akımı modeli: ~45° enlemde doğuya doğru güçlü rüzgâr.
// Dönüş: rotaya etki eden yer hızı bileşeni (km/sa, + arka rüzgâr)
function windComponent(pos, brg) {
  const jet = 110 * Math.exp(-(((pos.lat - 45) / 14) ** 2)); // doğuya esen
  return jet * Math.cos(rad(brg - 90));
}
