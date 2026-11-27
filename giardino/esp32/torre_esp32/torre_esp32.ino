// Torre idroponica · ESP32 + pompa (relè Tongling 5V, High Level Trigger) + SHT40
// Consumo ridotto: processore a 80 MHz, riposo leggero tra un evento e l'altro, Wi-Fi solo pochi secondi.
// Pompa: cicli in base alla temperatura e all'umidità misurate, più lunghi di notte; ferma sotto 2 °C
// (riparte sopra 4 °C). Misure salvate in memoria e mandate all'app Giardino quando c'è il Wi-Fi.
// Versione 3: pronta per l'app online (giardino-fede.netlify.app). Basta compilare Wi-Fi, password e chiave.
// Librerie (Gestione librerie dell'IDE): «Adafruit SHT4x» (con le sue dipendenze) e «ArduinoJson» 7.
// Scheda: «ESP32 Dev Module». Strumenti → Partition Scheme: «Default 4MB with spiffs» (serve per LittleFS).
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <Adafruit_SHT4x.h>
#include <time.h>
#include "esp_sleep.h"
#include "driver/gpio.h"

// ================== DA COMPILARE ==================
const char* WIFI_NOME     = "il-tuo-wifi";       // nome della rete (2,4 GHz: l'ESP32 non vede i 5 GHz)
const char* WIFI_PASSWORD = "la-tua-password";
// App Giardino → Impostazioni → Torre idroponica → accendi → «Copia la chiave» e incollala qui (26 lettere e numeri).
// Vuota = la torre lavora solo da sola e il Wi-Fi non si accende mai.
const char* CHIAVE_TORRE  = "";
const char* SITO          = "https://giardino-fede.netlify.app/api/torre";   // non cambiarlo
// ==================================================

const int  PIN_RELE    = 26;
const bool RELE_ATTIVO = HIGH;                         // High Level Trigger
const char* FUSO       = "CET-1CEST,M3.5.0,M10.5.0/3"; // ora italiana con ora legale
const uint32_t VERSIONE_FW = 3;
const uint32_t SVEGLIO_ALL_AVVIO_MS = 180000;          // 3 minuti per i comandi dal Monitor seriale

// ---------- impostazioni (in memoria; quelle dell'app arrivano al primo collegamento e a ogni modifica) ----------
struct Config {
  uint16_t accesaMin = 15;                         // minuti di pompa per ciclo
  float    soglie[5] = {30, 27, 20, 12, 5};        // °C: sopra 30, 27, 20, 12, 5
  uint16_t pause[6]  = {5, 10, 15, 25, 45, 60};    // minuti di pausa per fascia (ultima: tra 2 e 5 °C)
  float    freddoStop = 2.0;                       // sotto: pompa ferma (l'acqua può gelare)
  float    freddoRiparte = 4.0;                    // sopra: riparte
  uint8_t  notteDa = 22, notteA = 6;
  float    notteFattore = 2.0;
  float    umidoSoglia = 92, umidoFattore = 1.5;   // umidità alta (pioggia, nebbia): pausa più lunga
  uint16_t pausaMax = 120;                         // minuti
  uint16_t misuraOgniMin = 10, wifiOgniMin = 15, wifiMaxMin = 60;
  uint32_t rev = 0;                                // versione delle impostazioni (dall'app)
} cfg;

Preferences prefs;
Adafruit_SHT4x sht4;
bool shtOk = false;

float ultimaT = NAN, ultimaU = NAN;
uint32_t ultimaMisuraMs = 0;
uint32_t avvioN = 0;
uint32_t secondiPompa = 0;
bool fermaPerFreddo = false;

enum Modo : uint8_t { NORMALE, NOTTE, UMIDO, FREDDO, SENZA_SENSORE, MANUALE };
const char* NOMI_MODO[] = {"normale", "notte", "umido", "freddo: pompa ferma", "senza sensore", "manuale"};
Modo modo = NORMALE;

struct __attribute__((packed)) Record {   // 20 byte per misura
  uint32_t ora; uint32_t avvio; uint32_t sec;
  int16_t t100; uint16_t u100; uint16_t pompaS; uint8_t modo; uint8_t _;
};
const char* FILE_MISURE = "/misure.bin";
const size_t MAX_RECORD = 3000;           // ~3 settimane

// ---------- pompa ----------
bool pompaAccesa = false;
uint32_t fineFaseMs = 0, accesaDaMs = 0, manualeFinoMs = 0, pausaProssimaS = 0;

void rele(bool on) {
  if (on && !pompaAccesa) accesaDaMs = millis();
  if (!on && pompaAccesa) secondiPompa += (millis() - accesaDaMs) / 1000;
  pompaAccesa = on;
  gpio_hold_dis((gpio_num_t)PIN_RELE);
  digitalWrite(PIN_RELE, on ? RELE_ATTIVO : !RELE_ATTIVO);
}

bool oraNota() { return time(nullptr) > 1700000000; }
int oraDelGiorno() { time_t t = time(nullptr); struct tm tm; localtime_r(&t, &tm); return tm.tm_hour; }

// ---------- SHT40: media di 5 letture ----------
bool misura(float &t, float &u) {
  if (!shtOk) return false;
  float st = 0, su = 0; int n = 0;
  for (int i = 0; i < 5; i++) {
    sensors_event_t eu, et;
    if (sht4.getEvent(&eu, &et) && !isnan(et.temperature) && et.temperature > -40 && et.temperature < 125
        && eu.relative_humidity >= 0 && eu.relative_humidity <= 100) { st += et.temperature; su += eu.relative_humidity; n++; }
    if (i < 4) delay(200);
  }
  if (!n) return false;
  t = st / n; u = su / n; return true;
}
void aggiornaMisura() {
  float t, u;
  if (misura(t, u)) { ultimaT = t; ultimaU = u; } else { ultimaT = NAN; ultimaU = NAN; }
  ultimaMisuraMs = millis();
  if (!isnan(ultimaT)) {                                   // freddo con isteresi: ferma sotto 2, riparte sopra 4
    if (ultimaT < cfg.freddoStop) fermaPerFreddo = true;
    else if (ultimaT > cfg.freddoRiparte) fermaPerFreddo = false;
  }
}

// ---------- decisione del ciclo ----------
void decidi(uint32_t &accesaS, uint32_t &pausaS) {
  if (millis() - ultimaMisuraMs > 120000 || isnan(ultimaT)) aggiornaMisura();
  float T = ultimaT;
  if (isnan(T)) { modo = SENZA_SENSORE; accesaS = cfg.accesaMin * 60; pausaS = 20 * 60; return; }
  if (fermaPerFreddo) { modo = FREDDO; accesaS = 0; pausaS = cfg.misuraOgniMin * 60; return; }
  int fascia = 5;
  for (int i = 0; i < 5; i++) if (T > cfg.soglie[i]) { fascia = i; break; }
  float pausa = cfg.pause[fascia];
  modo = NORMALE;
  if (!isnan(ultimaU) && ultimaU >= cfg.umidoSoglia) { pausa *= cfg.umidoFattore; modo = UMIDO; }
  if (oraNota()) {
    int h = oraDelGiorno();
    bool notte = cfg.notteDa > cfg.notteA ? (h >= cfg.notteDa || h < cfg.notteA) : (h >= cfg.notteDa && h < cfg.notteA);
    if (notte) { pausa *= cfg.notteFattore; modo = NOTTE; }
  }
  if (pausa > cfg.pausaMax) pausa = cfg.pausaMax;
  accesaS = cfg.accesaMin * 60;
  pausaS = (uint32_t)(pausa * 60);
}

void prossimaFase() {
  if (pompaAccesa) {
    rele(false);
    fineFaseMs = millis() + pausaProssimaS * 1000UL;
    Serial.printf("Pompa spenta, pausa %lu min (%s)\n", pausaProssimaS / 60, NOMI_MODO[modo]);
    return;
  }
  uint32_t accesaS, pausaS;
  decidi(accesaS, pausaS);
  pausaProssimaS = pausaS;
  if (accesaS == 0) {
    fineFaseMs = millis() + pausaS * 1000UL;
    Serial.printf("Freddo (%.1f °C): pompa ferma, riparte sopra %.0f °C\n", ultimaT, cfg.freddoRiparte);
    return;
  }
  rele(true);
  fineFaseMs = millis() + accesaS * 1000UL;
  Serial.printf("Pompa accesa per %lu min (%s, %.1f °C, %.0f %%)\n", accesaS / 60, NOMI_MODO[modo], ultimaT, ultimaU);
}

// ---------- impostazioni in memoria ----------
void caricaConfig() { prefs.begin("torre", true); if (prefs.getBytesLength("cfg") == sizeof(Config)) prefs.getBytes("cfg", &cfg, sizeof(Config)); prefs.end(); }
void salvaConfig()  { prefs.begin("torre", false); prefs.putBytes("cfg", &cfg, sizeof(Config)); prefs.end(); }

// ---------- archivio delle misure ----------
size_t quanteMisure() { File f = LittleFS.open(FILE_MISURE, "r"); size_t n = f ? f.size() / sizeof(Record) : 0; if (f) f.close(); return n; }
void togliPrime(size_t n) {
  File f = LittleFS.open(FILE_MISURE, "r"); if (!f) return;
  File g = LittleFS.open("/tmp.bin", "w"); Record r; size_t i = 0;
  while (f.read((uint8_t*)&r, sizeof r) == sizeof r) { if (i++ >= n) g.write((uint8_t*)&r, sizeof r); }
  f.close(); g.close(); LittleFS.remove(FILE_MISURE); LittleFS.rename("/tmp.bin", FILE_MISURE);
}
void salvaMisura() {
  aggiornaMisura();
  if (pompaAccesa) { secondiPompa += (millis() - accesaDaMs) / 1000; accesaDaMs = millis(); }
  Record r{};
  r.ora = oraNota() ? (uint32_t)time(nullptr) : 0;
  r.avvio = avvioN; r.sec = millis() / 1000;
  r.t100 = isnan(ultimaT) ? -32767 : (int16_t)lroundf(ultimaT * 100);
  r.u100 = isnan(ultimaU) ? 0xFFFF : (uint16_t)lroundf(ultimaU * 100);
  r.pompaS = secondiPompa > 65535 ? 65535 : secondiPompa; secondiPompa = 0;
  r.modo = fermaPerFreddo ? FREDDO : modo;
  if (quanteMisure() >= MAX_RECORD) togliPrime(MAX_RECORD / 10);
  File f = LittleFS.open(FILE_MISURE, "a"); if (f) { f.write((uint8_t*)&r, sizeof r); f.close(); }
  Serial.printf("Misura: %.2f °C, %.1f %%, pompa %u s (in memoria: %u)\n", ultimaT, ultimaU, r.pompaS, (unsigned)quanteMisure());
  // freddo arrivato mentre la pompa gira: si ferma subito
  if (fermaPerFreddo && pompaAccesa && !manualeFinoMs) {
    rele(false); modo = FREDDO; fineFaseMs = millis() + cfg.misuraOgniMin * 60000UL;
    Serial.println("Freddo: pompa fermata subito");
  }
}

// ---------- rete ----------
uint32_t attesaWiFiMin = 15;
bool connettiWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NOME, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) delay(200);
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
  return false;
}
void spegniWiFi() { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }

void applicaConfig(JsonObject c) {
  if (c.isNull()) return;
  cfg.accesaMin     = c["accesa_min"]      | cfg.accesaMin;
  for (int i = 0; i < 5; i++) cfg.soglie[i] = c["soglie"][i] | cfg.soglie[i];
  for (int i = 0; i < 6; i++) cfg.pause[i]  = c["pause"][i]  | cfg.pause[i];
  cfg.freddoStop    = c["freddo_stop"]     | cfg.freddoStop;
  cfg.freddoRiparte = c["freddo_riparte"]  | cfg.freddoRiparte;
  if (cfg.freddoRiparte < cfg.freddoStop + 1) cfg.freddoRiparte = cfg.freddoStop + 1;
  cfg.notteDa       = c["notte_da"]        | cfg.notteDa;
  cfg.notteA        = c["notte_a"]         | cfg.notteA;
  cfg.notteFattore  = c["notte_fattore"]   | cfg.notteFattore;
  cfg.umidoSoglia   = c["umido_soglia"]    | cfg.umidoSoglia;
  cfg.umidoFattore  = c["umido_fattore"]   | cfg.umidoFattore;
  cfg.pausaMax      = c["pausa_max"]       | cfg.pausaMax;
  cfg.misuraOgniMin = c["misura_ogni_min"] | cfg.misuraOgniMin;
  cfg.wifiOgniMin   = c["wifi_ogni_min"]   | cfg.wifiOgniMin;
  cfg.wifiMaxMin    = c["wifi_max_min"]    | cfg.wifiMaxMin;
  cfg.rev           = c["rev"]             | cfg.rev;
  salvaConfig();
  Serial.printf("Impostazioni nuove dall'app (versione %lu)\n", cfg.rev);
}

bool chiaveRifiutata = false;
bool mandaBlocco(int &comandoPompaS) {
  File f = LittleFS.open(FILE_MISURE, "r");
  JsonDocument doc;
  doc["v"] = 1; doc["fw"] = VERSIONE_FW; doc["rev"] = cfg.rev; doc["avvio"] = avvioN;
  doc["sec"] = millis() / 1000; if (oraNota()) doc["ora"] = (uint32_t)time(nullptr);
  JsonObject st = doc["stato"].to<JsonObject>();
  st["modo"] = NOMI_MODO[fermaPerFreddo ? FREDDO : modo]; st["pompa"] = pompaAccesa; st["rssi"] = WiFi.RSSI();
  if (!isnan(ultimaT)) { st["t"] = ultimaT; st["u"] = ultimaU; }
  JsonArray m = doc["misure"].to<JsonArray>();
  Record r; size_t n = 0; uint32_t oraOra = oraNota() ? time(nullptr) : 0, secOra = millis() / 1000;
  while (f && n < 200 && f.read((uint8_t*)&r, sizeof r) == sizeof r) {
    uint32_t ora = r.ora;
    if (!ora && oraOra && r.avvio == avvioN) ora = oraOra - (secOra - r.sec);
    JsonArray x = m.add<JsonArray>();
    if (ora) x.add(ora); else x.add(nullptr);
    if (r.t100 == -32767) x.add(nullptr); else x.add(r.t100 / 100.0);
    if (r.u100 == 0xFFFF) x.add(nullptr); else x.add(r.u100 / 100.0);
    x.add(r.pompaS); x.add(r.modo); x.add(r.avvio); x.add(r.sec);
    n++;
  }
  if (f) f.close();
  String corpo; serializeJson(doc, corpo);

  WiFiClientSecure client; client.setInsecure();   // cifrata, senza verifica del certificato
  HTTPClient http; http.setTimeout(10000);
  if (!http.begin(client, SITO)) return false;
  http.addHeader("content-type", "application/json");
  http.addHeader("x-torre-chiave", CHIAVE_TORRE);
  int code = http.POST(corpo);
  String risposta = code > 0 ? http.getString() : "";
  http.end();
  if (code == 403) {
    chiaveRifiutata = true;
    Serial.println("Sito: chiave rifiutata. Ricopiala dall'app (Impostazioni → Torre idroponica) e ricarica il programma.");
    return false;
  }
  if (code != 200) { Serial.printf("Sito: risposta %d (%s)\n", code, code < 0 ? http.errorToString(code).c_str() : "riprovo più tardi"); return false; }

  JsonDocument ris;
  if (deserializeJson(ris, risposta) == DeserializationError::Ok) {
    applicaConfig(ris["config"].as<JsonObject>());
    int c = ris["comando"]["pompa_s"] | 0;                  // arriva una volta sola: non cancellarlo con l'invio dopo
    if (c > 0) comandoPompaS = c;
  }
  if (n) togliPrime(n);
  Serial.printf("Mandate %u misure\n", (unsigned)n);
  return true;
}

void collegati() {
  if (!strlen(CHIAVE_TORRE)) return;                       // senza chiave il Wi-Fi non si accende mai
  Serial.print("Provo il Wi-Fi... ");
  if (!connettiWiFi()) {
    attesaWiFiMin = min<uint32_t>(attesaWiFiMin * 2, cfg.wifiMaxMin);   // modem spento: si riprova più di rado
    Serial.printf("niente, riprovo tra %lu min\n", attesaWiFiMin);
    return;
  }
  attesaWiFiMin = cfg.wifiOgniMin;
  Serial.printf("collegata (segnale %d dBm)\n", WiFi.RSSI());
  configTzTime(FUSO, "pool.ntp.org", "time.google.com");
  struct tm tm; if (getLocalTime(&tm, 5000)) Serial.printf("Ora: %02d:%02d\n", tm.tm_hour, tm.tm_min);
  int comando = 0;
  chiaveRifiutata = false;
  for (int i = 0; i < 5; i++) { if (!mandaBlocco(comando) || !quanteMisure()) break; }
  spegniWiFi();
  if (chiaveRifiutata) attesaWiFiMin = cfg.wifiMaxMin;      // chiave sbagliata: riprova di rado, le misure restano in memoria
  if (comando > 0 && comando <= 600 && !fermaPerFreddo) {   // accensione dall'app, mai col freddo
    rele(true); modo = MANUALE; manualeFinoMs = millis() + comando * 1000UL;
    Serial.printf("Comando dall'app: pompa accesa %d s\n", comando);
  }
}

// ---------- riposo leggero fino al prossimo evento ----------
uint32_t prossimaMisuraMs = 0, prossimoWiFiMs = 0;
void riposa() {
  uint32_t ora = millis();
  int32_t attesa = 60000;                                   // al massimo 1 minuto per volta
  auto piuVicino = [&](uint32_t t) { int32_t d = (int32_t)(t - ora); if (d < attesa) attesa = d; };
  piuVicino(fineFaseMs); piuVicino(prossimaMisuraMs);
  if (strlen(CHIAVE_TORRE)) piuVicino(prossimoWiFiMs);
  if (manualeFinoMs) piuVicino(manualeFinoMs);
  if (attesa < 50) return;
  if (ora < SVEGLIO_ALL_AVVIO_MS) { delay(min<int32_t>(attesa, 100)); return; }   // primi 3 minuti: sveglio per i comandi
  Serial.flush();
  gpio_hold_en((gpio_num_t)PIN_RELE);                       // il relè resta com'è durante il riposo
  esp_sleep_enable_timer_wakeup((uint64_t)attesa * 1000ULL);
  esp_light_sleep_start();
  gpio_hold_dis((gpio_num_t)PIN_RELE);
}

void setup() {
  setCpuFrequencyMhz(80);                                   // basta e consuma meno
  pinMode(PIN_RELE, OUTPUT); digitalWrite(PIN_RELE, !RELE_ATTIVO);
  Serial.begin(115200); delay(300);
  Serial.println("\n=== Torre idroponica ===");
  setenv("TZ", FUSO, 1); tzset();
  WiFi.mode(WIFI_OFF);
  LittleFS.begin(true);
  caricaConfig();
  attesaWiFiMin = cfg.wifiOgniMin;
  prefs.begin("torre", false); avvioN = prefs.getUInt("avvii", 0) + 1; prefs.putUInt("avvii", avvioN); prefs.end();
  Wire.begin(21, 22);
  shtOk = sht4.begin();
  if (shtOk) { sht4.setPrecision(SHT4X_HIGH_PRECISION); sht4.setHeater(SHT4X_NO_HEATER); }
  Serial.println(shtOk ? "SHT40 ok" : "SHT40 NON trovato: ciclo fisso");
  Serial.printf("Misure in memoria: %u\n", (unsigned)quanteMisure());
  aggiornaMisura();
  prossimaFase();
  prossimaMisuraMs = millis() + 60000;
  prossimoWiFiMs = millis() + 20000;
  Serial.println("Comandi (primi 3 minuti dopo l'accensione): p = pompa 30 s, t = misura, s = stato, w = Wi-Fi, c = cancella misure");
}

void loop() {
  uint32_t ora = millis();
  if (manualeFinoMs && (int32_t)(ora - manualeFinoMs) >= 0) { manualeFinoMs = 0; rele(false); fineFaseMs = ora; }
  if (!manualeFinoMs && (int32_t)(ora - fineFaseMs) >= 0) prossimaFase();
  if ((int32_t)(ora - prossimaMisuraMs) >= 0) { salvaMisura(); prossimaMisuraMs = millis() + cfg.misuraOgniMin * 60000UL; }
  if ((int32_t)(ora - prossimoWiFiMs) >= 0) { collegati(); prossimoWiFiMs = millis() + attesaWiFiMin * 60000UL; }

  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'p') {
      if (fermaPerFreddo) Serial.println("Troppo freddo: la pompa resta ferma");
      else { rele(true); modo = MANUALE; manualeFinoMs = millis() + 30000; Serial.println("Pompa 30 s"); }
    }
    else if (c == 't') { aggiornaMisura(); Serial.printf("%.2f °C, %.1f %%%s\n", ultimaT, ultimaU, fermaPerFreddo ? " (freddo: pompa ferma)" : ""); }
    else if (c == 's') {
      Serial.printf("Pompa %s, modo %s, fase finisce tra %ld s\n", pompaAccesa ? "ACCESA" : "spenta",
                    NOMI_MODO[fermaPerFreddo ? FREDDO : modo], (long)((int32_t)(fineFaseMs - millis()) / 1000));
      Serial.printf("Ora %s, misure in memoria %u, prossimo Wi-Fi tra %lu min, impostazioni v%lu\n",
                    oraNota() ? "nota" : "non nota", (unsigned)quanteMisure(), (unsigned long)((int32_t)(prossimoWiFiMs - millis()) / 60000), cfg.rev);
    }
    else if (c == 'w') { collegati(); }
    else if (c == 'c') { LittleFS.remove(FILE_MISURE); Serial.println("Misure cancellate"); }
  }
  riposa();
}
