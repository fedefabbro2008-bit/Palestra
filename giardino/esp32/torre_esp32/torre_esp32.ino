// Torre idroponica · ESP32 + pompa (relè Tongling 5V, High Level Trigger) + SHT40
// Consumo ridotto: processore a 80 MHz, riposo leggero tra un evento e l'altro, Wi-Fi solo pochi secondi.
// Pompa: cicli in base alla temperatura e all'umidità misurate, più lunghi di notte; ferma sotto 2 °C
// (riparte sopra 4 °C). Misure salvate in memoria e mandate all'app Giardino quando c'è il Wi-Fi.
// Versione 9: pronta per l'app online (giardino-fede.netlify.app). Basta compilare Wi-Fi, password e chiave.
// Novità della v9: il power bank tenuto acceso si accende e si spegne dall'app; pezzi facoltativi, spenti di serie (vedi «PEZZI FACOLTATIVI» qui sotto): galleggiante del serbatoio
// (pompa bloccata col serbatoio vuoto), sonda DS18B20 nell'acqua (il gelo si decide sulla temperatura dell'acqua),
// misura della tensione di alimentazione (cali quando parte la pompa, power bank che si scarica).
// Novità della v8: diagnostica per l'app (memoria libera e impulsi del power bank non partiti); se la radio non parte
// per l'impulso si riprova una volta e intanto il processore resta occupato (consuma lo stesso); dopo un collegamento il
// prossimo impulso aspetta (la radio ha appena consumato).
// Novità della v7: correzione del termometro impostabile dall'app (l'umidità si ricalcola di conseguenza); l'impulso che
// tiene acceso il power bank si allunga da solo se il power bank si spegne lo stesso; dopo un riavvio senza mancanza di
// corrente l'ora resta quella giusta anche col modem spento.
// Novità della v6: tiene acceso il power bank (molti si spengono quando l'ESP32 a riposo consuma poco): ogni
// POWERBANK_OGNI_S secondi accende la radio del Wi-Fi per POWERBANK_PER_MS millisecondi, senza collegarsi al modem.
// Novità della v5: watchdog (se il programma si blocca l'ESP32 riparte da solo, con la pompa spenta); limite di sicurezza
// per la pompa accesa; motivo di ogni riavvio mandato all'app (corrente, calo di tensione, blocco); riscaldatore dell'SHT40
// quando resta a lungo nell'umidità.
// Novità della v4: certificato del sito verificato; misure cancellate solo dopo la conferma del sito; memoria non formattata
// al primo errore; sensore che non risponde: riprova, avvisa l'app, ciclo di emergenza impostabile e pompa ferma nelle ore di
// gelo previste dal meteo; a ogni accensione e spegnimento della pompa si collega e lo dice all'app (se il modem è acceso).
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
#include <sys/time.h>
#include "esp_sleep.h"
#include "esp_task_wdt.h"
#include "driver/gpio.h"

// ================== PEZZI FACOLTATIVI (0 = non montato, 1 = montato) ==================
#ifndef USA_GALLEGGIANTE
#define USA_GALLEGGIANTE 0   // galleggiante del serbatoio: un filo al GPIO 27, l'altro a GND
#endif
#ifndef USA_SONDA_ACQUA
#define USA_SONDA_ACQUA 0    // sonda DS18B20 nell'acqua: DAT al GPIO 4, VCC a 3V3, GND (schedina con la resistenza da 4,7 kΩ)
#endif                        //   serve installare le librerie «OneWire» e «DallasTemperature»
#ifndef USA_TENSIONE
#define USA_TENSIONE 0       // tensione di alimentazione: 5V → resistenza 100 kΩ → GPIO 34 → resistenza 100 kΩ → GND
#endif
const int  PIN_GALLEGGIANTE = 27;
const bool PIENO_SE_CHIUSO  = true;  // galleggiante a contatto chiuso quando c'è acqua; se funziona al contrario metti false
const int  PIN_SONDA_ACQUA  = 4;
const int  PIN_TENSIONE     = 34;
const float PARTITORE       = 2.0;   // due resistenze uguali: la tensione vera è il doppio di quella sul pin
#if USA_SONDA_ACQUA
#include <OneWire.h>
#include <DallasTemperature.h>
OneWire unFilo(PIN_SONDA_ACQUA);
DallasTemperature sondaAcqua(&unFilo);
#endif

// ================== DA COMPILARE ==================
const char* WIFI_NOME     = "il-tuo-wifi";       // nome della rete (2,4 GHz: l'ESP32 non vede i 5 GHz)
const char* WIFI_PASSWORD = "la-tua-password";
// App Giardino → Impostazioni → Torre idroponica → accendi → «Copia la chiave» e incollala qui (26 lettere e numeri).
// Vuota = la torre lavora solo da sola e il Wi-Fi non si accende mai.
const char* CHIAVE_TORRE  = "";
const char* SITO          = "https://giardino-fede.netlify.app/api/torre";   // non cambiarlo
// true: l'ESP32 controlla che il sito sia davvero quello giusto (certificato). Mettilo a false solo se nel Monitor
// seriale compare «certificato non accettato» e la torre non si collega più: vuol dire che il sito ha cambiato certificato.
const bool VERIFICA_CERTIFICATO = true;
// Alimentazione da power bank: true lo tiene acceso con un breve consumo ogni tanti secondi (circa 1 Wh al giorno).
// Si accende e si spegne dall'app (Impostazioni → Torre → Alimentazione): questo è solo il valore finché l'app non lo manda.
// Spento con un alimentatore da muro, un power bank con la modalità «bassa corrente» o una batteria fatta apposta.
// Se il power bank si spegne lo stesso (nell'app compare «è mancata la corrente»): POWERBANK_OGNI_S più basso
// (per esempio 8) o POWERBANK_PER_MS più alto (per esempio 3000).
const bool     TIENI_ACCESO_POWERBANK = true;
const uint32_t POWERBANK_OGNI_S  = 15;
const uint32_t POWERBANK_PER_MS  = 1500;
// ==================================================

const int  PIN_RELE    = 26;
const bool RELE_ATTIVO = HIGH;                         // High Level Trigger; va bene anche un modulo MOSFET (acceso con HIGH)
const char* FUSO       = "CET-1CEST,M3.5.0,M10.5.0/3"; // ora italiana con ora legale
const uint32_t VERSIONE_FW = 9;
const uint32_t WATCHDOG_S = 90;                        // il programma bloccato per 90 s: l'ESP32 riparte da solo
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
  uint16_t guastoPausa = 20;                       // sensore che non risponde: pausa del ciclo di emergenza (min)
  float    calT = 0;                               // correzione del termometro (°C), dall'app
  bool     guastoFerma = false;                    // sensore che non risponde: pompa ferma invece del ciclo
  uint32_t rev = 0;                                // versione delle impostazioni (dall'app)
  bool     tieniPb = TIENI_ACCESO_POWERBANK;      // power bank tenuto acceso, dall'app (in fondo: la struttura cambia
                                                   // misura, le impostazioni vecchie si scartano e il sito le rimanda)
} cfg;

Preferences prefs;
Adafruit_SHT4x sht4;
bool shtOk = false;

float ultimaT = NAN, ultimaU = NAN;
uint32_t ultimaMisuraMs = 0;
uint32_t avvioN = 0;
uint32_t secondiPompa = 0;
bool fermaPerFreddo = false;
uint16_t erroriSensore = 0;                        // misure di fila senza risposta dall'SHT40
bool memoriaOk = false, memoriaFormattata = false;  // LittleFS; «formattata» si dice al sito una volta
uint32_t pbOgniS = POWERBANK_OGNI_S, pbPerMs = POWERBANK_PER_MS; uint8_t pbAllungato = 0; bool pbVivoSegnato = false;   // power bank
uint32_t prossimoImpulsoMs = 0;                   // prossimo impulso per il power bank
uint16_t impulsiFalliti = 0;                       // impulsi in cui la radio non è partita (diagnostica per l'app)
uint32_t gelo[6][2]; uint8_t nGelo = 0;            // ore di gelo previste dal meteo (dal sito), usate solo col sensore guasto

enum Modo : uint8_t { NORMALE, NOTTE, UMIDO, FREDDO, SENZA_SENSORE, MANUALE, SICUREZZA, SERBATOIO_VUOTO };
const char* NOMI_MODO[] = {"normale", "notte", "umido", "freddo: pompa ferma", "senza sensore", "manuale", "sicurezza: pompa fermata", "serbatoio vuoto: pompa ferma"};
float tAcqua = NAN;                                // sonda nell'acqua (NAN se non c'è o non risponde)
bool serbatoioVuoto = false;                       // galleggiante: livello basso
float tensione = NAN, tensioneMin = NAN;           // alimentazione adesso e la più bassa dall'ultimo invio
const char* motivoRiavvio = "altro";               // perché l'ESP32 è ripartito: lo si dice all'app
uint8_t umidoDiFila = 0; uint32_t ultimoCaldoMs = 0; bool maiScaldato = true;   // riscaldatore dell'SHT40
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

// la pompa cambia: l'ESP32 si collega e lo dice all'app (3 s dopo, quando l'alimentazione si è assestata; al massimo uno al minuto)
bool comunicaPompa = false, wifiOk = true;
uint32_t cambioPompaMs = 0, ultimoInvioPompaMs = 0;
uint32_t quandoComunica() {
  uint32_t a = cambioPompaMs + 3000, b = ultimoInvioPompaMs + 60000;
  return ultimoInvioPompaMs && (int32_t)(b - a) > 0 ? b : a;
}
void leggiTensione();
void rele(bool on) {
  bool parte = on && !pompaAccesa;
  if (on != pompaAccesa) { comunicaPompa = true; cambioPompaMs = millis(); }
  if (on && !pompaAccesa) accesaDaMs = millis();
  if (!on && pompaAccesa) secondiPompa += (millis() - accesaDaMs) / 1000;
  pompaAccesa = on;
  gpio_hold_dis((gpio_num_t)PIN_RELE);
  digitalWrite(PIN_RELE, on ? RELE_ATTIVO : !RELE_ATTIVO);
#if USA_TENSIONE
  if (parte) { delay(150); leggiTensione(); }               // la tensione più bassa è appena parte la pompa (anche a mano)
#else
  (void)parte;
#endif
}

// ---------- ora: resta giusta dopo un riavvio senza mancanza di corrente (la memoria RTC non si cancella) ----------
RTC_NOINIT_ATTR uint32_t rtcFirma, rtcOra;
const uint32_t FIRMA_ORA = 0xC1A0C1A0;
void ricordaOra() { if (time(nullptr) > 1700000000) { rtcOra = (uint32_t)time(nullptr); rtcFirma = FIRMA_ORA; } }
void riprendiOra(bool accensione) {
  if (time(nullptr) > 1700000000) return;                  // già giusta
  if (!accensione && rtcFirma == FIRMA_ORA && rtcOra > 1700000000) {
    struct timeval tv = { (time_t)(rtcOra + 2), 0 }; settimeofday(&tv, nullptr);   // al massimo un minuto indietro
    Serial.println("Ora ripresa da prima del riavvio");
  }
  rtcFirma = 0;
}

// ---------- watchdog: se loop() non lo «tiene vivo» per WATCHDOG_S secondi, l'ESP32 riparte (con la pompa spenta) ----------
void avviaWatchdog() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t c = { .timeout_ms = WATCHDOG_S * 1000, .idle_core_mask = 0, .trigger_panic = true };
  if (esp_task_wdt_reconfigure(&c) != ESP_OK) esp_task_wdt_init(&c);
#else
  esp_task_wdt_init(WATCHDOG_S, true);
#endif
  esp_task_wdt_add(NULL);
}
inline void tieniVivo() { esp_task_wdt_reset(); }
// limite di sicurezza: la pompa non resta mai accesa più del doppio di un ciclo (almeno 15 minuti, per le accensioni a mano)
uint32_t limitePompaMs() { uint32_t m = 2UL * cfg.accesaMin * 60000UL; return m < 900000UL ? 900000UL : m; }

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
  t = st / n; u = su / n;
  // correzione del termometro: l'umidità relativa si ricalcola alla temperatura corretta, a parità di vapore nell'aria
  // (un sensore più caldo dell'aria, per esempio vicino all'ESP32, segna anche un'umidità più bassa del vero)
  if (cfg.calT != 0) {
    auto es = [](float T) { return 6.112f * expf(17.62f * T / (243.12f + T)); };   // pressione di saturazione (Magnus)
    float tc = t + cfg.calT, uc = u * es(t) / es(tc);
    t = tc; u = uc < 0 ? 0 : uc > 100 ? 100 : uc;
  }
  return true;
}
void avviaSensore() {
  shtOk = sht4.begin();
  if (shtOk) { sht4.setPrecision(SHT4X_HIGH_PRECISION); sht4.setHeater(SHT4X_NO_HEATER); }
}
// ---------- pezzi facoltativi ----------
void leggiAcqua() {
#if USA_SONDA_ACQUA
  sondaAcqua.requestTemperatures();
  float t = sondaAcqua.getTempCByIndex(0);
  tAcqua = (t == DEVICE_DISCONNECTED_C || t < -30 || t > 80) ? NAN : t;
#endif
}
// galleggiante: letto solo con la pompa spenta da almeno un minuto (con la pompa accesa l'acqua è nella torre e il livello
// scende); cinque letture, vince la maggioranza (l'acqua che ondeggia)
void leggiLivello() {
#if USA_GALLEGGIANTE
  if (pompaAccesa || (cambioPompaMs && millis() - cambioPompaMs < 60000UL)) return;   // all'accensione si legge subito
  int chiuso = 0; for (int i = 0; i < 5; i++) { chiuso += digitalRead(PIN_GALLEGGIANTE) == LOW; delay(20); }
  bool pieno = PIENO_SE_CHIUSO ? chiuso >= 3 : chiuso < 3;
  if (serbatoioVuoto && pieno) Serial.println("Galleggiante: serbatoio di nuovo pieno");
  if (!serbatoioVuoto && !pieno) Serial.println("Galleggiante: serbatoio vuoto, pompa ferma");
  serbatoioVuoto = !pieno;
#endif
}
void leggiTensione() {
#if USA_TENSIONE
  uint32_t mv = 0; for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_TENSIONE);
  tensione = mv / 8.0f / 1000.0f * PARTITORE;
  if (isnan(tensioneMin) || tensione < tensioneMin) tensioneMin = tensione;
#endif
}

void aggiornaMisura() {
  float t, u;
  bool ok = misura(t, u);
  if (!ok) { avviaSensore(); ok = misura(t, u); }          // non risponde: lo si riavvia e si riprova subito
  if (ok) { ultimaT = t; ultimaU = u; if (erroriSensore) Serial.println("Sensore di nuovo a posto"); erroriSensore = 0; }
  else { ultimaT = NAN; ultimaU = NAN; if (erroriSensore < 65535) erroriSensore++; }
  ultimaMisuraMs = millis();
  leggiAcqua(); leggiLivello(); leggiTensione();
  // freddo con isteresi (ferma sotto 2, riparte sopra 4): sulla temperatura dell'acqua se c'è la sonda, se no sull'aria;
  // senza nessuna delle due il freddo lo dicono le ore di gelo previste
  float tg = !isnan(tAcqua) ? tAcqua : ultimaT;
  if (isnan(tg)) fermaPerFreddo = false;
  else if (tg < cfg.freddoStop) fermaPerFreddo = true;
  else if (tg > cfg.freddoRiparte) fermaPerFreddo = false;
}
// SHT40 nell'umidità alta per ore (nebbia, pioggia): la misura dell'umidità resta alta anche dopo. Il suo riscaldatore
// interno lo asciuga: un secondo, al massimo una volta l'ora, dopo 3 misure di fila sopra il 95%. La misura dopo è fra 10 minuti.
void asciugaSensore() {
  if (!shtOk) return;
  sensors_event_t eu, et;
  sht4.setHeater(SHT4X_MED_HEATER_1S); sht4.getEvent(&eu, &et); sht4.setHeater(SHT4X_NO_HEATER);
  ultimoCaldoMs = millis(); maiScaldato = false; umidoDiFila = 0; ultimaMisuraMs = millis();
  Serial.println("Sensore asciugato (riscaldatore, 1 s)");
}
// sensore guasto: gelo previsto adesso? (serve l'ora giusta)
bool geloPrevisto() {
  if (!oraNota()) return false;
  uint32_t t = time(nullptr);
  for (uint8_t i = 0; i < nGelo; i++) if (t >= gelo[i][0] && t < gelo[i][1]) return true;
  return false;
}
// il freddo lo dice la sonda dell'acqua se c'è (fermaPerFreddo), se no l'aria; senza nessuna delle due, le ore di gelo previste
bool pompaVietata() { return fermaPerFreddo || (isnan(ultimaT) && isnan(tAcqua) && geloPrevisto()); }

// ---------- decisione del ciclo ----------
void decidi(uint32_t &accesaS, uint32_t &pausaS) {
  if (millis() - ultimaMisuraMs > 120000 || isnan(ultimaT)) aggiornaMisura();
  float T = ultimaT;
  leggiLivello();
  if (serbatoioVuoto) { modo = SERBATOIO_VUOTO; accesaS = 0; pausaS = cfg.misuraOgniMin * 60; return; }   // galleggiante
  if (fermaPerFreddo) { modo = FREDDO; accesaS = 0; pausaS = cfg.misuraOgniMin * 60; return; }
  if (isnan(T)) {                                          // sensore guasto: ciclo di emergenza, ferma col gelo previsto
    modo = SENZA_SENSORE;
    if (cfg.guastoFerma || (isnan(tAcqua) && geloPrevisto())) { accesaS = 0; pausaS = cfg.misuraOgniMin * 60; }
    else { accesaS = cfg.accesaMin * 60; pausaS = cfg.guastoPausa * 60; }
    return;
  }
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
    if (modo == SERBATOIO_VUOTO) Serial.println("Serbatoio vuoto: pompa ferma finché non lo riempi");
    else if (modo == SENZA_SENSORE) Serial.println(isnan(tAcqua) && geloPrevisto() ? "Sensore guasto e gelo previsto: pompa ferma" : "Sensore guasto: pompa ferma (impostazioni)");
    else Serial.printf("Freddo (%.1f °C): pompa ferma, riparte sopra %.0f °C\n", ultimaT, cfg.freddoRiparte);
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
size_t quanteMisure() { if (!memoriaOk) return 0; File f = LittleFS.open(FILE_MISURE, "r"); size_t n = f ? f.size() / sizeof(Record) : 0; if (f) f.close(); return n; }
void togliPrime(size_t n) {
  if (!memoriaOk) return;
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
  r.modo = modo == SICUREZZA ? SICUREZZA : fermaPerFreddo ? FREDDO : modo;
  if (quanteMisure() >= MAX_RECORD) togliPrime(MAX_RECORD / 10);
  if (memoriaOk) { File f = LittleFS.open(FILE_MISURE, "a"); if (f) { f.write((uint8_t*)&r, sizeof r); f.close(); } }
  Serial.printf("Misura: %.2f °C, %.1f %%, pompa %u s (in memoria: %u)\n", ultimaT, ultimaU, r.pompaS, (unsigned)quanteMisure());
  if (!isnan(ultimaU) && ultimaU >= 95) { if (umidoDiFila < 255) umidoDiFila++; } else umidoDiFila = 0;
  if (umidoDiFila >= 3 && (maiScaldato || millis() - ultimoCaldoMs > 3600000UL)) asciugaSensore();
  if (erroriSensore) Serial.printf("Sensore: nessuna risposta (%u volte di fila)\n", erroriSensore);
  // freddo (misurato, o previsto col sensore guasto) arrivato mentre la pompa gira: si ferma subito
  if (pompaVietata() && pompaAccesa) {
    rele(false); manualeFinoMs = 0; modo = fermaPerFreddo ? FREDDO : SENZA_SENSORE; fineFaseMs = millis() + cfg.misuraOgniMin * 60000UL;
    Serial.println("Freddo: pompa fermata subito");
  }
}

// ---------- rete ----------
uint32_t attesaWiFiMin = 15;
bool connettiWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NOME, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 10000) { delay(200); tieniVivo(); }
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
  cfg.guastoPausa   = c["guasto_pausa"]    | cfg.guastoPausa;
  cfg.guastoFerma   = c["guasto_ferma"]    | cfg.guastoFerma;
  cfg.calT          = c["cal_t"]           | cfg.calT;
  cfg.tieniPb       = c["tieni_pb"]        | cfg.tieniPb;
  if (cfg.calT < -10 || cfg.calT > 10) cfg.calT = 0;
  cfg.rev           = c["rev"]             | cfg.rev;
  salvaConfig();
  Serial.printf("Impostazioni nuove dall'app (versione %lu)\n", cfg.rev);
}

void caricaGelo() { prefs.begin("torre", true); nGelo = prefs.getUChar("ngelo", 0); if (nGelo > 6) nGelo = 0; if (nGelo) prefs.getBytes("gelo", gelo, sizeof gelo); prefs.end(); }
void applicaGelo(JsonArray g) {
  if (g.isNull()) return;                                  // il sito non ha il meteo: si tengono quelle di prima
  uint32_t nuovo[6][2] = {}; uint8_t n = 0;
  for (JsonArray x : g) { if (n >= 6) break; nuovo[n][0] = x[0] | 0UL; nuovo[n][1] = x[1] | 0UL; if (nuovo[n][1] > nuovo[n][0]) n++; }
  if (n == nGelo && !memcmp(nuovo, gelo, n * sizeof nuovo[0])) return;   // uguali: la memoria flash non si riscrive
  memset(gelo, 0, sizeof gelo); memcpy(gelo, nuovo, n * sizeof nuovo[0]); nGelo = n;
  prefs.begin("torre", false); prefs.putUChar("ngelo", nGelo); prefs.putBytes("gelo", gelo, sizeof gelo); prefs.end();
  if (nGelo) Serial.printf("Gelo previsto: %u periodi (servono solo se il sensore si guasta)\n", nGelo);
}

// Certificati delle autorità che firmano i siti come Netlify (Let's Encrypt, DigiCert, Google, Amazon, Sectigo):
// più di una, così la torre continua a collegarsi anche se il sito cambia chi gli firma il certificato.
const char* CERTIFICATI = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICPzCCAcWgAwIBAgIQBVVWvPJepDU1w6QP1atFcjAKBggqhkjOPQQDAzBhMQsw
CQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cu
ZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMzAe
Fw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUw
EwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20x
IDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEczMHYwEAYHKoZIzj0CAQYF
K4EEACIDYgAE3afZu4q4C/sLfyHS8L6+c/MzXRq8NOrexpu80JX28MzQC7phW1FG
fp4tn+6OYwwX7Adw9c+ELkCDnOg/QW07rdOkFFk2eJ0DQ+4QE2xy3q6Ip6FrtUPO
Z9wj/wMco+I+o0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHQ4EFgQUs9tIpPmhxdiuNkHMEWNpYim8S8YwCgYIKoZIzj0EAwMDaAAwZQIx
AK288mw/EkrRLTnDCgmXc/SINoyIJ7vmiI1Qhadj+Z4y3maTD/HMsQmP3Wyr+mt/
oAIwOWZbwmSNuJ5Q3KjVSaLtx9zRSX8XAbjIho9OjIgrqJqpisXRAL34VOKa5Vt8
sycX
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFZjCCA06gAwIBAgIQCPm0eKj6ftpqMzeJ3nzPijANBgkqhkiG9w0BAQwFADBN
MQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xJTAjBgNVBAMT
HERpZ2lDZXJ0IFRMUyBSU0E0MDk2IFJvb3QgRzUwHhcNMjEwMTE1MDAwMDAwWhcN
NDYwMTE0MjM1OTU5WjBNMQswCQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQs
IEluYy4xJTAjBgNVBAMTHERpZ2lDZXJ0IFRMUyBSU0E0MDk2IFJvb3QgRzUwggIi
MA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCz0PTJeRGd/fxmgefM1eS87IE+
ajWOLrfn3q/5B03PMJ3qCQuZvWxX2hhKuHisOjmopkisLnLlvevxGs3npAOpPxG0
2C+JFvuUAT27L/gTBaF4HI4o4EXgg/RZG5Wzrn4DReW+wkL+7vI8toUTmDKdFqgp
wgscONyfMXdcvyej/Cestyu9dJsXLfKB2l2w4SMXPohKEiPQ6s+d3gMXsUJKoBZM
pG2T6T867jp8nVid9E6P/DsjyG244gXazOvswzH016cpVIDPRFtMbzCe88zdH5RD
nU1/cHAN1DrRN/BsnZvAFJNY781BOHW8EwOVfH/jXOnVDdXifBBiqmvwPXbzP6Po
sMH976pXTayGpxi0KcEsDr9kvimM2AItzVwv8n/vFfQMFawKsPHTDU9qTXeXAaDx
Zre3zu/O7Oyldcqs4+Fj97ihBMi8ez9dLRYiVu1ISf6nL3kwJZu6ay0/nTvEF+cd
Lvvyz6b84xQslpghjLSR6Rlgg/IwKwZzUNWYOwbpx4oMYIwo+FKbbuH2TbsGJJvX
KyY//SovcfXWJL5/MZ4PbeiPT02jP/816t9JXkGPhvnxd3lLG7SjXi/7RgLQZhNe
XoVPzthwiHvOAbWWl9fNff2C+MIkwcoBOU+NosEUQB+cZtUMCUbW8tDRSHZWOkPL
tgoRObqME2wGtZ7P6wIDAQABo0IwQDAdBgNVHQ4EFgQUUTMc7TZArxfTJc1paPKv
TiM+s0EwDgYDVR0PAQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcN
AQEMBQADggIBAGCmr1tfV9qJ20tQqcQjNSH/0GEwhJG3PxDPJY7Jv0Y02cEhJhxw
GXIeo8mH/qlDZJY6yFMECrZBu8RHANmfGBg7sg7zNOok992vIGCukihfNudd5N7H
PNtQOa27PShNlnx2xlv0wdsUpasZYgcYQF+Xkdycx6u1UQ3maVNVzDl92sURVXLF
O4uJ+DQtpBflF+aZfTCIITfNMBc9uPK8qHWgQ9w+iUuQrm0D4ByjoJYJu32jtyoQ
REtGBzRj7TG5BO6jm5qu5jF49OokYTurWGT/u4cnYiWB39yhL/btp/96j1EuMPik
AdKFOV8BmZZvWltwGUb+hmA+rYAQCd05JS9Yf7vSdPD3Rh9GOUrYU9DzLjtxpdRv
/PNn5AeP3SYZ4Y1b+qOTEZvpyDrDVWiakuFSdjjo4bq9+0/V77PnSIMx8IIh47a+
p6tv75/fTM8BuGJqIz3nCU2AG3swpMPdB380vqQmsvZB6Akd4yCYqjdP//fx4ilw
MUc/dNAUFvohigLVigmUdy7yWSiLfFCSCmZ4OIN1xLVaqBHG5cGdZlXPU8Sv13WF
qUITVuwhd4GTWgzqltlJyqEI8pc7bZsEGCREjnwB8twl2F6GmrE52/WRMmrRpnCK
ovfepEWFJqgejF0pW8hL2JpqA15w8oVPbEtoL8pU9ozaMv7Da4M/OMZ+
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGTCCAZ+gAwIBAgIQCeCTZaz32ci5PhwLBCou8zAKBggqhkjOPQQDAzBOMQsw
CQYDVQQGEwJVUzEXMBUGA1UEChMORGlnaUNlcnQsIEluYy4xJjAkBgNVBAMTHURp
Z2lDZXJ0IFRMUyBFQ0MgUDM4NCBSb290IEc1MB4XDTIxMDExNTAwMDAwMFoXDTQ2
MDExNDIzNTk1OVowTjELMAkGA1UEBhMCVVMxFzAVBgNVBAoTDkRpZ2lDZXJ0LCBJ
bmMuMSYwJAYDVQQDEx1EaWdpQ2VydCBUTFMgRUNDIFAzODQgUm9vdCBHNTB2MBAG
ByqGSM49AgEGBSuBBAAiA2IABMFEoc8Rl1Ca3iOCNQfN0MsYndLxf3c1TzvdlHJS
7cI7+Oz6e2tYIOyZrsn8aLN1udsJ7MgT9U7GCh1mMEy7H0cKPGEQQil8pQgO4CLp
0zVozptjn4S1mU1YoI71VOeVyaNCMEAwHQYDVR0OBBYEFMFRRVBZqz7nLFr6ICIS
B4CIfBFqMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49
BAMDA2gAMGUCMQCJao1H5+z8blUD2WdsJk6Dxv3J+ysTvLd6jLRl0mlpYxNjOyZQ
LgGheQaRnUi/wr4CMEfDFXuxoJGZSZOoPHzoRgaLLPIxAJSdYsiJvRmEFOml+wG4
DXZDjC5Ty3zfDBeWUA==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF
ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6
b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv
b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj
ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM
9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw
IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6
VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L
93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm
jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA
A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI
U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs
N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv
o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU
5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy
rqXRfboQnoZsG4q5WTP468SQvvG5
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAw
MjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNV
BAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVU
aGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2Vy
dGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B
3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkY
tJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/
Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2
VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT
79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6
c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmT
Yo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97l
c6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4ee
UB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeE
Hg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAd
BgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPF
Up/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KO
VWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3
ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs
8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcR
iQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYze
Sf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZ
XHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/
qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRB
VXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aB
L6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfG
jjxDah2nGN59PRbxYvnKkKj9
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICjzCCAhWgAwIBAgIQXIuZxVqUxdJxVt7NiYDMJjAKBggqhkjOPQQDAzCBiDEL
MAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNl
eSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMT
JVVTRVJUcnVzdCBFQ0MgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAwMjAx
MDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNVBAgT
Ck5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVUaGUg
VVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBFQ0MgQ2VydGlm
aWNhdGlvbiBBdXRob3JpdHkwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAQarFRaqflo
I+d61SRvU8Za2EurxtW20eZzca7dnNYMYf3boIkDuAUU7FfO7l0/4iGzzvfUinng
o4N+LZfQYcTxmdwlkWOrfzCjtHDix6EznPO/LlxTsV+zfTJ/ijTjeXmjQjBAMB0G
A1UdDgQWBBQ64QmG1M8ZwpZ2dEl23OA1xmNjmjAOBgNVHQ8BAf8EBAMCAQYwDwYD
VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAwNoADBlAjA2Z6EWCNzklwBBHU6+4WMB
zzuqQhFkoJ2UOQIReVx7Hfpkue4WQrO/isIJxOzksU0CMQDpKmFHjFJKS04YcPbW
RNZu9YO6bVi9JNlWSOrvxKJGgYhqOkbRqZtNyWHa0V1Xahg=
-----END CERTIFICATE-----
)PEM";

bool chiaveRifiutata = false;
bool mandaBlocco(int &comandoPompaS) {
  File f = LittleFS.open(FILE_MISURE, "r");
  JsonDocument doc;
  doc["v"] = 1; doc["fw"] = VERSIONE_FW; doc["rev"] = cfg.rev; doc["avvio"] = avvioN;
  doc["sec"] = millis() / 1000; if (oraNota()) doc["ora"] = (uint32_t)time(nullptr);
  JsonObject st = doc["stato"].to<JsonObject>();
  st["modo"] = NOMI_MODO[fermaPerFreddo ? FREDDO : modo]; st["pompa"] = pompaAccesa; st["rssi"] = WiFi.RSSI();
  if (erroriSensore) st["sensore_errori"] = erroriSensore;
  if (!isnan(tAcqua)) st["ta"] = tAcqua;                   // pezzi facoltativi
#if USA_GALLEGGIANTE
  st["livello"] = serbatoioVuoto ? "basso" : "ok";
#endif
  if (!isnan(tensione)) { st["v"] = tensione; st["vmin"] = tensioneMin; }
  if (cfg.tieniPb) { JsonArray pb = st["pb"].to<JsonArray>(); pb.add(pbOgniS); pb.add(pbPerMs); pb.add(pbAllungato); }
  { JsonArray dg = st["diag"].to<JsonArray>(); dg.add(ESP.getFreeHeap()); dg.add(ESP.getMinFreeHeap()); dg.add(impulsiFalliti); }   // diagnostica
  st["riavvio"] = motivoRiavvio;
  if (oraNota()) {                                          // da quando la pompa è così e quando finisce questa fase (ora vera)
    uint32_t adesso = time(nullptr), ms = millis(), fineMs = manualeFinoMs ? manualeFinoMs : fineFaseMs;
    st["da"] = adesso - (ms - cambioPompaMs) / 1000;
    if ((int32_t)(fineMs - ms) > 0) st["fine"] = adesso + (fineMs - ms) / 1000;
  }
  if (memoriaFormattata) st["memoria"] = "formattata";
  if (!memoriaOk) st["memoria"] = "guasta";
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

  WiFiClientSecure client;
  if (VERIFICA_CERTIFICATO) client.setCACert(CERTIFICATI); else client.setInsecure();
  client.setHandshakeTimeout(20);                           // connessione 10 s + certificato 20 s + risposta 15 s: sotto il watchdog (90 s)
  HTTPClient http; http.setConnectTimeout(10000); http.setTimeout(15000);
  tieniVivo();
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
  if (code < 0) {
    Serial.printf("Sito: nessuna risposta (%s)%s\n", http.errorToString(code).c_str(),
                  VERIFICA_CERTIFICATO ? ". Se succede sempre con il Wi-Fi che va: certificato non accettato (vedi VERIFICA_CERTIFICATO)" : "");
    return false;
  }
  if (code != 200) { Serial.printf("Sito: risposta %d, riprovo più tardi\n", code); return false; }

  // le misure si cancellano solo se il sito conferma di averle ricevute ({"ok": true}); rimandarle è sicuro: il sito toglie i doppioni
  JsonDocument ris;
  if (deserializeJson(ris, risposta) != DeserializationError::Ok || !ris["ok"].as<bool>()) { Serial.println("Sito: risposta non valida, le misure restano in memoria"); return false; }
  applicaConfig(ris["config"].as<JsonObject>());
  applicaGelo(ris["gelo"].as<JsonArray>());
  int c = ris["comando"]["pompa_s"] | 0;                    // arriva una volta sola: non cancellarlo con l'invio dopo
  if (c > 0) comandoPompaS = c;
  memoriaFormattata = false;                                // detto al sito
  tensioneMin = tensione;                                   // la più bassa riparte da adesso
  if (n) togliPrime(n);
  Serial.printf("Mandate %u misure\n", (unsigned)n);
  return true;
}

void collegati() {
  if (!strlen(CHIAVE_TORRE)) return;                       // senza chiave il Wi-Fi non si accende mai
  Serial.print("Provo il Wi-Fi... ");
  if (!connettiWiFi()) {
    wifiOk = false;                                         // modem spento: niente collegamenti a ogni cambio della pompa
    attesaWiFiMin = min<uint32_t>(attesaWiFiMin * 2, cfg.wifiMaxMin);   // modem spento: si riprova più di rado
    Serial.printf("niente, riprovo tra %lu min\n", attesaWiFiMin);
    return;
  }
  attesaWiFiMin = cfg.wifiOgniMin; wifiOk = true;
  Serial.printf("collegata (segnale %d dBm)\n", WiFi.RSSI());
  configTzTime(FUSO, "pool.ntp.org", "time.google.com");
  struct tm tm; if (getLocalTime(&tm, 5000)) Serial.printf("Ora: %02d:%02d\n", tm.tm_hour, tm.tm_min);
  if (VERIFICA_CERTIFICATO && !oraNota()) {                 // senza l'ora giusta il certificato non si può controllare
    spegniWiFi(); Serial.println("Ora non ricevuta: riprovo più tardi"); return;
  }
  int comando = 0;
  chiaveRifiutata = false;
  for (int i = 0; i < 5; i++) { tieniVivo(); if (!mandaBlocco(comando) || !quanteMisure()) break; }
  tieniVivo();
  spegniWiFi();
  if (chiaveRifiutata) attesaWiFiMin = cfg.wifiMaxMin;      // chiave sbagliata: riprova di rado, le misure restano in memoria
  prossimoImpulsoMs = millis() + pbOgniS * 1000UL;         // la radio ha appena consumato: il prossimo impulso aspetta
  if (comando > 0 && comando <= 600 && !pompaVietata() && !serbatoioVuoto) {   // accensione dall'app, mai col freddo né a secco
    rele(true); modo = MANUALE; manualeFinoMs = millis() + comando * 1000UL;
    Serial.printf("Comando dall'app: pompa accesa %d s\n", comando);
  }
}

// ---------- power bank: un breve consumo ogni tanto, perché non si spenga ----------
// La radio del Wi-Fi che cerca le reti consuma oltre 100 mA: abbastanza perché il power bank veda un carico.
// Non serve con la pompa accesa (consuma già lei) né durante un collegamento.
// Se l'ESP32 riparte per «corrente» dopo essere stato acceso almeno 3 minuti, probabilmente il power bank si è spento:
// l'impulso diventa più frequente e più lungo (fino a 4 s ogni 5 s) e il programma se lo ricorda. Un programma nuovo riparte
// dai valori scritti sopra.
void caricaPowerBank(bool fwNuovo, bool persaCorrente) {
  prefs.begin("torre", false);
  if (fwNuovo) { prefs.putUInt("pbOgni", POWERBANK_OGNI_S); prefs.putUInt("pbPer", POWERBANK_PER_MS); prefs.putUChar("pbN", 0); }
  pbOgniS = prefs.getUInt("pbOgni", POWERBANK_OGNI_S); pbPerMs = prefs.getUInt("pbPer", POWERBANK_PER_MS); pbAllungato = prefs.getUChar("pbN", 0);
  bool eraVivo = prefs.getBool("pbVivo", false);
  if (eraVivo) prefs.putBool("pbVivo", false);
  if (cfg.tieniPb && persaCorrente && eraVivo && !fwNuovo && (pbOgniS > 5 || pbPerMs < 4000)) {
    pbOgniS = max<uint32_t>(5, pbOgniS * 2 / 3); pbPerMs = min<uint32_t>(4000, pbPerMs * 3 / 2); if (pbAllungato < 99) pbAllungato++;
    prefs.putUInt("pbOgni", pbOgniS); prefs.putUInt("pbPer", pbPerMs); prefs.putUChar("pbN", pbAllungato);
    Serial.printf("Power bank spento? Impulso allungato: %lu ms ogni %lu s\n", (unsigned long)pbPerMs, (unsigned long)pbOgniS);
  }
  prefs.end();
}
void segnaVivo() {                                          // acceso da 3 minuti: un riavvio dopo non è un collegamento a mano
  if (pbVivoSegnato || millis() < 180000UL) return;
  pbVivoSegnato = true; prefs.begin("torre", false); prefs.putBool("pbVivo", true); prefs.end();
}
bool avviaRicerca() { return WiFi.mode(WIFI_STA) && WiFi.scanNetworks(true) != WIFI_SCAN_FAILED; }   // ricerca delle reti in sottofondo
void impulsoPowerBank() {
  bool radio = avviaRicerca();
  if (!radio) { WiFi.mode(WIFI_OFF); delay(20); radio = avviaRicerca(); }   // non partita: si riprova una volta da capo
  if (!radio && impulsiFalliti < 65535) impulsiFalliti++;
  uint32_t t0 = millis();
  // con la radio accesa si aspetta a riposo; senza, il processore resta occupato (consuma meno, ma qualcosa)
  while (millis() - t0 < pbPerMs) { if (radio) delay(50); tieniVivo(); }
  WiFi.scanDelete();
  WiFi.mode(WIFI_OFF);
}
void tieniAccesoPowerBank() {
  if (!cfg.tieniPb || (int32_t)(millis() - prossimoImpulsoMs) < 0) return;
  if (!pompaAccesa) impulsoPowerBank();
  prossimoImpulsoMs = millis() + pbOgniS * 1000UL;
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
  if (comunicaPompa) piuVicino(quandoComunica());
  if (cfg.tieniPb) piuVicino(prossimoImpulsoMs);
  if (attesa < 50) return;
  if (ora < SVEGLIO_ALL_AVVIO_MS) { delay(min<int32_t>(attesa, 100)); return; }   // primi 3 minuti: sveglio per i comandi
  Serial.flush();
  tieniVivo();
  gpio_hold_en((gpio_num_t)PIN_RELE);                       // il relè resta com'è durante il riposo
  esp_sleep_enable_timer_wakeup((uint64_t)attesa * 1000ULL);
  esp_light_sleep_start();
  gpio_hold_dis((gpio_num_t)PIN_RELE);
  tieniVivo();
}

void setup() {
  gpio_hold_dis((gpio_num_t)PIN_RELE);                      // dopo un riavvio dal riposo: il relè torna libero e spento
  pinMode(PIN_RELE, OUTPUT); digitalWrite(PIN_RELE, !RELE_ATTIVO);
  setCpuFrequencyMhz(80);                                   // basta e consuma meno
  Serial.begin(115200); delay(300);
  Serial.printf("\n=== Torre idroponica · programma v%lu ===\n", (unsigned long)VERSIONE_FW);
  avviaWatchdog();
  setenv("TZ", FUSO, 1); tzset();
  WiFi.mode(WIFI_OFF);
  prefs.begin("torre", false); avvioN = prefs.getUInt("avvii", 0) + 1; prefs.putUInt("avvii", avvioN);
  // perché è ripartito: programma nuovo (anche caricato col cavo), corrente, calo di tensione, blocco, errore
  bool fwNuovo = prefs.getUInt("fw", 0) != VERSIONE_FW; if (fwNuovo) prefs.putUInt("fw", VERSIONE_FW);
  prefs.end();
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: motivoRiavvio = "corrente"; break;
    case ESP_RST_BROWNOUT: motivoRiavvio = "tensione"; break;
    case ESP_RST_TASK_WDT: case ESP_RST_INT_WDT: case ESP_RST_WDT: motivoRiavvio = "blocco"; break;
    case ESP_RST_PANIC: motivoRiavvio = "errore"; break;
    case ESP_RST_SW: motivoRiavvio = "programma"; break;
    case ESP_RST_EXT: motivoRiavvio = "tasto"; break;
    default: motivoRiavvio = "altro";
  }
  bool accensione = esp_reset_reason() == ESP_RST_POWERON;
  if (fwNuovo) motivoRiavvio = "programma";
  Serial.printf("Riavvio: %s\n", motivoRiavvio);
  riprendiOra(accensione);
  caricaConfig();                                           // prima del power bank: dice se tenerlo acceso
  caricaPowerBank(fwNuovo, accensione && !fwNuovo);
  // memoria: si riprova prima di formattare; la prima accensione in assoluto la formatta senza dirlo (è vuota)
  for (int i = 0; i < 3 && !memoriaOk; i++) { memoriaOk = LittleFS.begin(false); if (!memoriaOk) delay(300); }
  if (!memoriaOk) {
    Serial.println("Memoria delle misure non leggibile: la formatto");
    memoriaOk = LittleFS.begin(true);
    memoriaFormattata = memoriaOk && avvioN > 1;
    if (!memoriaOk) Serial.println("Memoria guasta: la torre lavora lo stesso, ma le misure non restano se manca il Wi-Fi");
  }
  caricaGelo();
  attesaWiFiMin = cfg.wifiOgniMin;
  Wire.begin(21, 22);
  avviaSensore();
#if USA_GALLEGGIANTE
  pinMode(PIN_GALLEGGIANTE, INPUT_PULLUP);
  delay(10); leggiLivello();                                // pompa sicuramente spenta: il livello si sa prima del primo ciclo
#endif
#if USA_SONDA_ACQUA
  sondaAcqua.begin(); sondaAcqua.setResolution(11);         // 0,125 °C, misura in circa 0,4 s
  Serial.println(sondaAcqua.getDeviceCount() ? "Sonda dell'acqua ok" : "Sonda dell'acqua NON trovata");
#endif
  Serial.println(shtOk ? "SHT40 ok" : "SHT40 NON trovato: ciclo di emergenza (riprova a ogni misura)");
  Serial.printf("Misure in memoria: %u\n", (unsigned)quanteMisure());
  aggiornaMisura();
  prossimaFase();
  prossimaMisuraMs = millis() + 60000;
  prossimoWiFiMs = millis() + 20000;
  if (cfg.tieniPb) Serial.printf("Power bank tenuto acceso: radio accesa %lu ms ogni %lu s\n", (unsigned long)pbPerMs, (unsigned long)pbOgniS);
  prossimoImpulsoMs = millis() + pbOgniS * 1000UL;
  Serial.println("Comandi (primi 3 minuti dopo l'accensione): p = pompa 30 s, t = misura, s = stato, w = Wi-Fi, c = cancella misure");
}

void loop() {
  tieniVivo();
  ricordaOra(); segnaVivo();
  uint32_t ora = millis();
  // limite di sicurezza: pompa accesa troppo a lungo (errore nel programma): si spegne e lo si registra
  if (pompaAccesa && ora - cambioPompaMs > limitePompaMs()) {
    rele(false); manualeFinoMs = 0; modo = SICUREZZA;
    Serial.println("SICUREZZA: pompa accesa troppo a lungo, spenta");
    salvaMisura(); prossimaMisuraMs = millis() + cfg.misuraOgniMin * 60000UL;
    fineFaseMs = millis() + cfg.misuraOgniMin * 60000UL; ora = millis();
  }
  if (manualeFinoMs && (int32_t)(ora - manualeFinoMs) >= 0) { manualeFinoMs = 0; rele(false); fineFaseMs = ora; }
  if (!manualeFinoMs && (int32_t)(ora - fineFaseMs) >= 0) prossimaFase();
  if ((int32_t)(ora - prossimaMisuraMs) >= 0) { salvaMisura(); prossimaMisuraMs = millis() + cfg.misuraOgniMin * 60000UL; }
  if ((int32_t)(ora - prossimoWiFiMs) >= 0) { comunicaPompa = false; collegati(); prossimoWiFiMs = millis() + attesaWiFiMin * 60000UL; }
  if (comunicaPompa && (int32_t)(millis() - quandoComunica()) >= 0) {
    comunicaPompa = false;
    if (strlen(CHIAVE_TORRE) && wifiOk) {                   // modem spento: lo saprà l'app al prossimo collegamento
      Serial.printf("Pompa %s: lo dico all'app\n", pompaAccesa ? "accesa" : "spenta");
      ultimoInvioPompaMs = millis(); collegati();
      prossimoWiFiMs = millis() + attesaWiFiMin * 60000UL;  // il collegamento a orario riparte da qui
    }
  }

  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'p') {
      if (serbatoioVuoto) Serial.println("Serbatoio vuoto: la pompa resta ferma");
      else if (pompaVietata()) Serial.println("Troppo freddo: la pompa resta ferma");
      else { rele(true); modo = MANUALE; manualeFinoMs = millis() + 30000; Serial.println("Pompa 30 s"); }
    }
    else if (c == 't') {
      aggiornaMisura(); Serial.printf("%.2f °C, %.1f %%%s\n", ultimaT, ultimaU, fermaPerFreddo ? " (freddo: pompa ferma)" : "");
      if (USA_SONDA_ACQUA) Serial.printf("Acqua: %.2f °C\n", tAcqua);
      if (USA_GALLEGGIANTE) Serial.println(serbatoioVuoto ? "Serbatoio: vuoto" : "Serbatoio: ok");
      if (USA_TENSIONE) Serial.printf("Alimentazione: %.2f V (minima %.2f V)\n", tensione, tensioneMin);
    }
    else if (c == 's') {
      Serial.printf("Pompa %s, modo %s, fase finisce tra %ld s\n", pompaAccesa ? "ACCESA" : "spenta",
                    NOMI_MODO[fermaPerFreddo ? FREDDO : modo], (long)((int32_t)(fineFaseMs - millis()) / 1000));
      Serial.printf("Ora %s, misure in memoria %u, prossimo Wi-Fi tra %lu min, impostazioni v%lu\n",
                    oraNota() ? "nota" : "non nota", (unsigned)quanteMisure(), (unsigned long)((int32_t)(prossimoWiFiMs - millis()) / 60000), cfg.rev);
    }
    else if (c == 'w') { collegati(); }
    else if (c == 'c') { if (memoriaOk) LittleFS.remove(FILE_MISURE); Serial.println("Misure cancellate"); }
  }
  tieniAccesoPowerBank();
  riposa();
}
