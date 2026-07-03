# Boğaziçi Havayolları — Uçuş Operasyon Merkezi Simülasyonu

Kurgusal bir havayolu şirketinin (BJ / "BOSPHORUS") tüm uçuş operasyonunu
gerçek zamanlı simüle eden, tarayıcıda çalışan bir uygulama. Harici bağımlılık
yoktur; saf HTML + CSS + JavaScript.

![Uçuş Operasyon Merkezi](docs/ekran-operasyon-merkezi.png)

*Seçili uçuş: büyük daire rotası, canlı telemetri ve olay geçmişi*

![Uçuş detayı](docs/ekran-ucus-detayi.png)

## Çalıştırma

- **En kolay:** `index.html` dosyasına çift tıklayın.
- veya bir sunucuyla: `python -m http.server 8123` → `http://localhost:8123`
- İpucu: `index.html?ff=300` gibi bir adresle simülasyonu 300 dakika ileri
  sarılmış olarak başlatabilirsiniz (tanıtım/test için).

## Ne simüle ediliyor?

### Filo (13 uçak, tipe göre performans)
ATR 72-600, A320neo, A321neo, 737-800, A330-300, 787-9, A350-900, 777-300ER.
Her tipin kendi seyir hızı, tavanı, tırmanma oranı, menzili, yakıt sarfiyatı,
koltuk kapasitesi ve turnaround süresi vardır. Turboproplar fırtınanın
üzerinden aşamaz, geniş gövdeler uzun hat uçar (İstanbul'dan JFK, Singapur,
São Paulo, Tokyo...).

### Uçuş yaşam döngüsü
Planlama → Biniş → Taksi → Kalkış → Tırmanış → Seyir → Alçalma →
(Bekleme paterni) → Yaklaşma → İniş → Taksi → Kapı. Yakıt planı gerçekçi
kurala göre hesaplanır: sefer yakıtı + %5 + alternatif meydan + 45 dk rezerv.

### Yolda karşılaşılan zorluklar
- **Hareket eden hava hücreleri:** oraj (TS), türbülans (TURB), buzlanma (ICE);
  şiddet 1–3. Uçak tavanı yetiyorsa üzerinden aşar, yetmiyorsa rota sapması
  yapar (gecikme + ekstra yakıt). Şiddetli türbülansta yaralanma riski.
- **Jet akımı:** ~45° enlemde doğuya esen rüzgâr; doğu yönlü uçuşlar hızlanır,
  batı yönlüler yavaşlar.
- **Havalimanı meteorolojisi:** sis/düşük görüş (CAT III olmayan meydanlarda
  kalkış bekletir, inişte bekleme paternine sokar), kuvvetli rüzgârda
  **pas geçme** olasılığı artar.
- **Bekleme ve divert:** hava düzelmezse veya yakıt asgariye inerse en yakın
  uygun meydana yönlendirme; MINIMUM FUEL / MAYDAY FUEL prosedürleri.
- **Teknik/operasyonel olaylar:** kalkış öncesi teknik rötar ve iptal, kuş
  çarpması (geri dönüş kararı), motor arızası (PAN PAN), kabin basıncı kaybı
  (MAYDAY + acil alçalma), tıbbi acil durum (en yakın meydana iniş), hidrolik
  uyarısı (varışta bakım). Olay yaşayan uçak yerde +90 dk bakıma alınır.

### Şirket katmanı
Uçaklar otomatik tarifelenir (üsten çık, üsse dön), turnaround süreleri
işler; üst barda tamamlanan uçuş, zamanındalık (%), divert, iptal, taşınan
yolcu, gelir ve yakıt tüketimi izlenir.

## Arayüz
- **Harita:** uçaklar (rotaya dönük üçgen), hava hücreleri, havalimanları
  (≋ = düşük görüş). Uçağa tıklayınca rota ve detay paneli açılır.
- **Sol panel:** aktif uçuşlar ve filo durumu.
- **Sağ panel:** seçili uçuşun detayı (irtifa, hız, yakıt, gecikme, olaylar)
  ve tüm şirketin operasyon günlüğü.
- **Hız kontrolü:** ⏸ / 1 / 5 / 15 simülasyon dakikası ÷ saniye.

## Dosya yapısı
```
index.html        arayüz iskeleti
css/style.css     koyu "operasyon merkezi" teması
js/data.js        uçak tipleri, 40 havalimanı, filo planı
js/geo.js         büyük daire matematiği, jet akımı modeli
js/weather.js     dinamik hava hücreleri + meydan meteorolojisi
js/flight.js      uçuş faz makinesi, yakıt, olaylar, divert mantığı
js/sim.js         simülasyon saati, tarifeleme, istatistikler
js/ui.js          canvas harita + paneller
js/main.js        başlatma ve ana döngü
```
