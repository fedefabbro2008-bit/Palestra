// Modello di calcolo: specie coerenti, ordine alfabetico, fasi dell'aglio, zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../netlify/lib/modello.mjs";

test("ogni specie ha dati completi", () => {
  for (const [k, s] of Object.entries(M.SPECIE)) {
    assert.equal(s.kc.length, 5, k + ": kc");
    assert.ok(s.ico && s.nome && M.CATEGORIE[s.cat], k + ": ico, nome, gruppo");
    if (s.ann) { assert.equal(s.ciclo.length, 6, k + ": ciclo"); const v = s.ciclo.filter((x) => x != null); assert.ok(v.every((x, i) => !i || x > v[i - 1]), k + ": ciclo crescente"); }
    else assert.match(s.cal, /^[RVFTM]{12}$/, k + ": calendario");
  }
});

test("specie in ordine alfabetico, «Altra pianta» in fondo", () => {
  const nomi = M.specieOrdinate().map(([, s]) => s.nome);
  assert.equal(nomi.at(-1), "Altra pianta");
  const resto = nomi.slice(0, -1);
  assert.deepEqual(resto, [...resto].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" })));
});

test("aglio piantato a novembre: fasi e nome del bulbo", () => {
  const p = { id: "a", specie: "aglio", fase: "auto", data_semina: "2026-11-03", tipo_data: "semina", colt: "vaso", vaso: 30, num: 3, luce: 4, dove: "aperto" };
  const fasi = ["2026-11-03", "2027-03-01", "2027-05-10", "2027-06-20"].map((d) => M.faseEffettiva(p, d, 44.2).fase);
  assert.deepEqual(fasi, ["germinazione", "vegetativa", "fruttificazione", "maturazione"]);
  assert.equal(M.nomeFase("aglio", "fruttificazione"), "Ingrossamento del bulbo");
  assert.equal(M.nomeFase("pomodoro", "fruttificazione"), "Fruttificazione");
  assert.equal(M.params(p, { oggi: "2027-05-10", lat: 44.2 }).faseNome, "Ingrossamento del bulbo");
});

test("piante ordinate per zona e poi per nome", () => {
  const ord = M.pianteOrdinate([{ nome: "zucca" }, { nome: "Aglio", zona: "orto" }, { nome: "basilico", zona: "Balcone" }, { nome: "aneto" }, { nome: "Rosa", zona: " balcone " }]);
  assert.deepEqual(ord.map((p) => p.nome), ["basilico", "Rosa", "Aglio", "aneto", "zucca"]);
});

test("avviso del gelo con l'ora leggibile", () => {
  const [a] = M.avvisiDomani([{ id: "l", nome: "Limone", specie: "agrumi", colt: "vaso", dove: "aperto" }], { tmin: 6, tmax: 15 }, [{ ora: "03", t: 1 }, { ora: "05", t: 0.5 }]);
  assert.match(a.testo, /verso le 05:00/);
});

test("in casa: a 20 °C come prima, più caldo = più acqua; temperatura del giorno tra le stagioni", () => {
  assert.ok(Math.abs(M.et0Casa(4, 20) - (0.8 + 0.15 * 4)) < 1e-9);
  assert.ok(Math.abs(M.et0Casa(4) - M.et0Casa(4, 20)) < 1e-9);
  const r26 = M.et0Casa(4, 26) / M.et0Casa(4, 20), r16 = M.et0Casa(4, 16) / M.et0Casa(4, 20);
  assert.ok(r26 > 1.2 && r26 < 1.4, "26 °C: +20/40%"); assert.ok(r16 > 0.75 && r16 < 0.9, "16 °C: −10/25%");
  const tc = M.tempCasa({ tcasa: { inverno: 16, estate: "" } });
  assert.deepEqual(tc, { inverno: 16, primavera: 21, estate: 26, autunno: 21 });
  assert.equal(M.tempCasaGiorno(tc, "2026-01-15", 44), 16);
  assert.equal(M.tempCasaGiorno(tc, "2026-07-15", 44), 26);
  const nov = M.tempCasaGiorno(tc, "2026-11-30", 44); assert.ok(nov > 16 && nov < 21, "fine novembre tra autunno e inverno");
  assert.ok(Math.abs(M.tempCasaGiorno(tc, "2026-07-15", -34) - 16) < 0.3, "emisfero sud: luglio è inverno");
  const p = { id: "po", specie: "appartamento", fase: "vegetativa", colt: "vaso", vaso: 3, luce: 2, dove: "interno" };
  const k = M.params(p, { oggi: "2026-07-15", lat: 44 });
  assert.ok(M.consumoL(k, { date: "2026-07-15" }) > M.consumoL(k, { date: "2026-01-15" }), "d'estate beve di più");
  assert.equal(M.params({ ...p, dove: "aperto" }, { oggi: "2026-07-15" }).tcasa, null);
});

test("calendario dei mesi: dalla semina al raccolto, oppure l'anno tipico", () => {
  const aglio = M.calendarioAuto({ specie: "aglio", fase: "auto", data_semina: "2026-11-03", tipo_data: "semina" }, 44);
  assert.equal(aglio.tipo, "ciclo"); assert.equal(aglio.mesi[0].mese, "2026-11");
  assert.ok(aglio.mesi.at(-1).raccolta && aglio.mesi.at(-1).mese.startsWith("2027-0"), "raccolta in estate 2027");
  assert.ok(!aglio.mesi.some((m) => m.frutti), "l'aglio non fa frutti: fa il bulbo");
  const pom = M.calendarioAuto({ specie: "pomodoro", fase: "auto", data_semina: "2027-05-10", tipo_data: "trapianto" }, 44);
  assert.deepEqual(pom.mesi.filter((m) => m.frutti).map((m) => m.mese), ["2027-07", "2027-08"]);
  const lim = M.calendarioAuto({ specie: "agrumi" }, 44);
  assert.equal(lim.tipo, "anno"); assert.equal(lim.mesi.length, 12); assert.ok(lim.mesi.some((m) => m.frutti));
  assert.deepEqual(M.calendarioAuto({ specie: "basilico" }, 44), { tipo: null, mesi: [] });
});

test("vasi piccoli: la chioma non supera circa il doppio del vaso (niente acqua tutti i giorni a un vasetto)", () => {
  const p = { id: "c", specie: "appartamento", fase: "auto", colt: "vaso", vaso: 0.3, diametro: 7, num: 1, luce: 1, dove: "interno" };
  const k = M.params(p, { oggi: "2026-11-03", lat: 44 });
  assert.ok(k.chioma <= 4 * Math.PI * 0.035 ** 2 + 1e-9);
  const giorni = k.rawL / M.consumoL(k, { date: "2026-11-03" });
  assert.ok(giorni > 3 && giorni < 10, "ogni 3-10 giorni, non tutti i giorni: " + giorni.toFixed(1));
  const conArea = M.params({ ...p, area: 0.1 }, { oggi: "2026-11-03", lat: 44 });
  assert.equal(conArea.chioma, 0.1, "se la superficie è indicata vale quella");
});
