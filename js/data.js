// ============================================================
// Boğaziçi Havayolları — Filo, uçak tipi ve havalimanı verileri
// Hız: km/sa, irtifa: metre, menzil/mesafe: km, yakıt: kg
// ============================================================

const AIRCRAFT_TYPES = {
  ATR72: {
    label: "ATR 72-600", cat: "turboprop",
    cruiseSpeed: 510, ceiling: 7600, cruiseAlt: 7000, climbRate: 330,
    range: 1400, pax: 70, fuelBurn: 620, fuelCap: 5000,
    turnaround: 35, maxDist: 1100,
  },
  A20N: {
    label: "Airbus A320neo", cat: "narrow",
    cruiseSpeed: 830, ceiling: 12000, cruiseAlt: 11300, climbRate: 480,
    range: 6300, pax: 180, fuelBurn: 2150, fuelCap: 19000,
    turnaround: 45,
  },
  B738: {
    label: "Boeing 737-800", cat: "narrow",
    cruiseSpeed: 840, ceiling: 12500, cruiseAlt: 11600, climbRate: 470,
    range: 5400, pax: 189, fuelBurn: 2450, fuelCap: 20800,
    turnaround: 45,
  },
  A21N: {
    label: "Airbus A321neo", cat: "narrow",
    cruiseSpeed: 830, ceiling: 12000, cruiseAlt: 11300, climbRate: 450,
    range: 6800, pax: 220, fuelBurn: 2600, fuelCap: 23700,
    turnaround: 50,
  },
  A333: {
    label: "Airbus A330-300", cat: "wide",
    cruiseSpeed: 870, ceiling: 12500, cruiseAlt: 11900, climbRate: 400,
    range: 11700, pax: 290, fuelBurn: 5600, fuelCap: 97000,
    turnaround: 75, minDist: 2200,
  },
  B789: {
    label: "Boeing 787-9", cat: "wide",
    cruiseSpeed: 900, ceiling: 13100, cruiseAlt: 12200, climbRate: 430,
    range: 14000, pax: 290, fuelBurn: 5400, fuelCap: 101000,
    turnaround: 75, minDist: 2200,
  },
  A359: {
    label: "Airbus A350-900", cat: "wide",
    cruiseSpeed: 900, ceiling: 13100, cruiseAlt: 12500, climbRate: 430,
    range: 15000, pax: 325, fuelBurn: 5800, fuelCap: 110000,
    turnaround: 75, minDist: 2200,
  },
  B77W: {
    label: "Boeing 777-300ER", cat: "wide",
    cruiseSpeed: 900, ceiling: 13100, cruiseAlt: 12000, climbRate: 390,
    range: 13600, pax: 360, fuelBurn: 7500, fuelCap: 145000,
    turnaround: 80, minDist: 2200,
  },
};

// cat3: CAT III ILS — düşük görüşte (sis) iniş yapılabilir
const AIRPORTS = {
  IST: { code: "IST", name: "İstanbul",        lat: 41.26, lon: 28.74,  cat3: true },
  SAW: { code: "SAW", name: "Sabiha Gökçen",   lat: 40.90, lon: 29.31,  cat3: true },
  ESB: { code: "ESB", name: "Ankara Esenboğa", lat: 40.13, lon: 32.99,  cat3: true },
  ADB: { code: "ADB", name: "İzmir",           lat: 38.29, lon: 27.16,  cat3: false },
  AYT: { code: "AYT", name: "Antalya",         lat: 36.90, lon: 30.80,  cat3: false },
  ADA: { code: "ADA", name: "Adana",           lat: 36.98, lon: 35.28,  cat3: false },
  TZX: { code: "TZX", name: "Trabzon",         lat: 40.99, lon: 39.79,  cat3: false },
  DIY: { code: "DIY", name: "Diyarbakır",      lat: 37.89, lon: 40.20,  cat3: false },
  VAN: { code: "VAN", name: "Van",             lat: 38.47, lon: 43.33,  cat3: false },
  GZT: { code: "GZT", name: "Gaziantep",       lat: 36.95, lon: 37.48,  cat3: false },
  BJV: { code: "BJV", name: "Bodrum",          lat: 37.25, lon: 27.66,  cat3: false },
  LHR: { code: "LHR", name: "Londra Heathrow", lat: 51.47, lon: -0.45,  cat3: true },
  CDG: { code: "CDG", name: "Paris CDG",       lat: 49.01, lon: 2.55,   cat3: true },
  FRA: { code: "FRA", name: "Frankfurt",       lat: 50.03, lon: 8.57,   cat3: true },
  AMS: { code: "AMS", name: "Amsterdam",       lat: 52.31, lon: 4.76,   cat3: true },
  MUC: { code: "MUC", name: "Münih",           lat: 48.35, lon: 11.79,  cat3: true },
  BER: { code: "BER", name: "Berlin",          lat: 52.36, lon: 13.50,  cat3: true },
  FCO: { code: "FCO", name: "Roma",            lat: 41.80, lon: 12.24,  cat3: false },
  MAD: { code: "MAD", name: "Madrid",          lat: 40.47, lon: -3.56,  cat3: true },
  BCN: { code: "BCN", name: "Barselona",       lat: 41.30, lon: 2.08,   cat3: false },
  SVO: { code: "SVO", name: "Moskova",         lat: 55.97, lon: 37.41,  cat3: true },
  JFK: { code: "JFK", name: "New York JFK",    lat: 40.64, lon: -73.78, cat3: true },
  YYZ: { code: "YYZ", name: "Toronto",         lat: 43.68, lon: -79.63, cat3: true },
  ORD: { code: "ORD", name: "Chicago",         lat: 41.97, lon: -87.90, cat3: true },
  DXB: { code: "DXB", name: "Dubai",           lat: 25.25, lon: 55.36,  cat3: true },
  DOH: { code: "DOH", name: "Doha",            lat: 25.27, lon: 51.61,  cat3: true },
  JED: { code: "JED", name: "Cidde",           lat: 21.68, lon: 39.16,  cat3: false },
  CAI: { code: "CAI", name: "Kahire",          lat: 30.12, lon: 31.41,  cat3: false },
  DEL: { code: "DEL", name: "Delhi",           lat: 28.56, lon: 77.10,  cat3: true },
  BKK: { code: "BKK", name: "Bangkok",         lat: 13.69, lon: 100.75, cat3: false },
  SIN: { code: "SIN", name: "Singapur",        lat: 1.36,  lon: 103.99, cat3: true },
  HKG: { code: "HKG", name: "Hong Kong",       lat: 22.31, lon: 113.91, cat3: true },
  ICN: { code: "ICN", name: "Seul Incheon",    lat: 37.46, lon: 126.44, cat3: true },
  NRT: { code: "NRT", name: "Tokyo Narita",    lat: 35.77, lon: 140.39, cat3: true },
  PVG: { code: "PVG", name: "Şanghay",         lat: 31.14, lon: 121.81, cat3: true },
  GRU: { code: "GRU", name: "São Paulo",       lat: -23.44, lon: -46.47, cat3: true },
  CPT: { code: "CPT", name: "Cape Town",       lat: -33.97, lon: 18.60, cat3: false },
  JNB: { code: "JNB", name: "Johannesburg",    lat: -26.14, lon: 28.25, cat3: false },
  LOS: { code: "LOS", name: "Lagos",           lat: 6.58,  lon: 3.32,   cat3: false },
  NBO: { code: "NBO", name: "Nairobi",         lat: -1.32, lon: 36.93,  cat3: false },
};

// Filo — tescil, tip, ana üs
const FLEET_PLAN = [
  { reg: "TC-BGA", type: "A20N",  hub: "IST" },
  { reg: "TC-BGB", type: "A20N",  hub: "IST" },
  { reg: "TC-BGC", type: "B738",  hub: "SAW" },
  { reg: "TC-BGD", type: "B738",  hub: "SAW" },
  { reg: "TC-BGE", type: "A21N",  hub: "IST" },
  { reg: "TC-BGF", type: "A21N",  hub: "SAW" },
  { reg: "TC-BGG", type: "ATR72", hub: "ESB" },
  { reg: "TC-BGH", type: "ATR72", hub: "ESB" },
  { reg: "TC-BGJ", type: "A333",  hub: "IST" },
  { reg: "TC-BGK", type: "B789",  hub: "IST" },
  { reg: "TC-BGL", type: "A359",  hub: "IST" },
  { reg: "TC-BGM", type: "B77W",  hub: "IST" },
  { reg: "TC-BGN", type: "A20N",  hub: "AYT" },
];

const AIRLINE = { name: "BOĞAZİÇİ HAVAYOLLARI", iata: "BJ", callsign: "BOSPHORUS" };
