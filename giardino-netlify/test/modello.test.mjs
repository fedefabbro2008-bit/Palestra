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

test("veranda/serra: niente pioggia, temperature proprie, più sole che in casa; il vetro tiene 4 gradi", () => {
  const base = { id: "s", specie: "pomodoro", fase: "vegetativa", colt: "vaso", vaso: 12, num: 1, luce: 6 };
  const serra = M.params({ ...base, dove: "serra" }, { oggi: "2026-07-15", lat: 44 }), casa = M.params({ ...base, dove: "interno" }, { oggi: "2026-07-15", lat: 44 });
  assert.ok(serra.interno && serra.serra);
  assert.deepEqual(serra.tcasa, M.TSERRA_DEF);
  assert.ok(M.consumoL(serra, { date: "2026-07-15" }) > M.consumoL(casa, { date: "2026-07-15" }), "in serra beve più che in casa");
  assert.equal(M.pioggiaL({ ...base, dove: "serra" }, serra, { rain: 20 }), 0);
  assert.equal(M.avvisiDomani([{ ...base, nome: "P", dove: "serra" }], { tmin: 5, tmax: 12 }, [{ ora: "04", t: 5 }]).length, 0, "5 °C fuori: in serra niente gelo");
  assert.equal(M.avvisiDomani([{ ...base, nome: "P", dove: "serra" }], { tmin: 0, tmax: 8 }, [{ ora: "04", t: 0 }]).length, 1, "0 °C fuori: avviso anche in serra");
});

test("pioggia prevista pesata con la probabilità", () => {
  assert.equal(M.pioggiaAttesa({ rain: 20, prob: 56 }).rain, 14);
  assert.equal(M.pioggiaAttesa({ rain: 20, prob: 95 }).rain, 20);
  assert.equal(M.pioggiaAttesa({ rain: 20 }).rain, 20);
});

test("avviso di gelo: in veranda/serra non dice di portare al riparo", () => {
  const [a] = M.avvisiDomani([{ id: "a", nome: "Basilico", specie: "basilico", colt: "vaso", dove: "aperto" }, { id: "b", nome: "Pomodori", specie: "pomodoro", colt: "vaso", dove: "serra" }], { tmin: 0, tmax: 9 }, [{ ora: "04", t: 0 }]);
  assert.match(a.testo, /porta al riparo o copri con tessuto non tessuto Basilico; in veranda\/serra chiudi bene e copri Pomodori\./);
});

test("calibrazione: la stessa risposta di fila corregge di più, una opposta riparte", () => {
  const ev = (tipi) => tipi.map((tipo, i) => ({ id: "e" + i, plantId: "x", tipo, data: "2026-11-0" + (i + 1), fonte: "app" }));
  assert.ok(Math.abs(M.calibrazione(ev(["umido"]), "x", "2026-11-09") - 0.9) < 1e-9);
  assert.ok(Math.abs(M.calibrazione(ev(["umido", "umido", "umido"]), "x", "2026-11-09") - 0.9 * 0.85 * 0.8) < 1e-9);
  assert.ok(Math.abs(M.calibrazione(ev(["umido", "secco"]), "x", "2026-11-09") - 0.9 * 1.12) < 1e-9);
});

test("vaso: terracotta beve di più, senza fori dose esatta, riserva allunga gli intervalli, caldo e vento sui vasi piccoli", () => {
  const p = { id: "v", nome: "Basilico", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 4, num: 1, luce: 7, dove: "aperto" };
  const k = (x) => M.params({ ...p, ...x }, { oggi: "2026-07-15", lat: 44 });
  assert.ok(Math.abs(k({ materiale: "terracotta" }).lPerMm / k({}).lPerMm - 1.25) < 1e-9);
  const r = k({ riserva: 1 }); assert.ok(Math.abs(r.rawL - k({}).rawL - 1) < 1e-9 && r.riserva === 1);
  const base = k({}), d = { date: "2026-07-15", et0: 5, tmax: 34, wind: 35 };
  assert.ok(Math.abs(M.consumoL(base, d) / M.consumoL(base, { ...d, tmax: 25, wind: 5 }) - 1.25) < 1e-9, "+15% caldo +10% vento");
  const giorni = ["2026-07-15", "2026-07-16", "2026-07-17"].map((date) => ({ date, et0: 6, tmax: 30, tmin: 18, rain: 0, prob: 0, wind: 5 }));
  const piano = (x) => M.pianoLocale({ piante: [{ ...p, ...x }], fut: giorni, oggi: "2026-07-15", lat: 44 }).piante[0].giorni.find((g) => g.azione === "innaffia");
  const ap = piano({}), ch = piano({ materiale: "chiuso" });
  assert.match(ch.motivo, /senza fori/); assert.match(ap.motivo, /esce dal foro/);
  // pioggia forte su vaso senza fori: avviso
  const pioggia = giorni.map((g) => ({ ...g, rain: 40, prob: 100 }));
  assert.match(M.pianoLocale({ piante: [{ ...p, materiale: "chiuso" }], fut: pioggia, oggi: "2026-07-15", lat: 44 }).avvisi.join(" "), /vasi senza fori/);
});

test("avvisi di temporale, grandine e raffiche", () => {
  const vaso = { id: "b", nome: "Basilico", specie: "basilico", colt: "vaso", vaso: 4, dove: "aperto", materiale: "chiuso" };
  const terra = { id: "z", nome: "Zucchine", specie: "zucchina", colt: "terra", dove: "aperto" };
  const serra = { id: "s", nome: "Limone", specie: "agrumi", colt: "vaso", vaso: 40, dove: "serra" };
  const dom = { tmin: 15, tmax: 26, wind: 20 };
  const gr = M.avvisiDomani([vaso, terra, serra], { ...dom, code: 96 }).find((a) => a.tipo === "grandine");
  assert.match(gr.testo, /metti al riparo Basilico; copri .* Zucchine/); assert.ok(!gr.testo.includes("Limone"), "in serra niente grandine");
  const tm = M.avvisiDomani([vaso, serra], { ...dom, code: 95, rain: 18 }).find((a) => a.tipo === "temporale");
  assert.match(tm.testo, /circa 18 mm.*vasi leggeri \(Basilico\).*senza fori \(Basilico\)/);
  assert.match(M.avvisiDomani([vaso], { ...dom, raffiche: 72 }).find((a) => a.tipo === "vento").testo, /^Raffiche fino a 72 km\/h/);
  assert.equal(M.avvisiDomani([vaso], { ...dom, code: 3, raffiche: 40 }).length, 0, "cielo coperto e raffiche deboli: niente avvisi");
  const fut = ["2026-07-15", "2026-07-16", "2026-07-17"].map((date, i) => ({ date, et0: 5, tmax: 26, tmin: 15, rain: 0, prob: 0, wind: 5, code: i === 2 ? 99 : 1 }));
  assert.match(M.pianoLocale({ piante: [vaso], fut, oggi: "2026-07-15", lat: 44 }).avvisi.join(" "), /Possibile grandine venerdì/);
});

test("primi giorni: media con ICON-2I solo dove copre il giorno intero", () => {
  const days = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map((date) => ({ date, rain: 10, prob: 80, tmax: 14, tmin: 6 }));
  const ore = (d, n, p, t) => [...Array(n)].map((_, h) => ({ t: d + "T" + String(h).padStart(2, "0") + ":00", p, T: t + (h === 14 ? 4 : 0) }));
  const h = [...ore("2026-11-06", 24, 0.25, 8), ...ore("2026-11-07", 24, 0, 7), ...ore("2026-11-08", 12, 1, 7)];
  const out = M.mediaModelli(days, { time: h.map((x) => x.t), precipitation: h.map((x) => x.p), temperature_2m: h.map((x) => x.T) }, "2026-11-06");
  assert.deepEqual(out.map((d) => d.rain), [10, 8, 5, 10, 10], "ieri no; oggi (10+6)/2; domani (10+0)/2; terzo giorno incompleto: resta");
  assert.deepEqual(out[1].rain_modelli, [10, 6]); assert.equal(out[1].prob, 80);
  assert.equal(out[1].tmax, 13); assert.equal(out[1].tmin, 7);
  assert.equal(M.mediaModelli(days, undefined, "2026-11-06"), days);
});

test("specie riconosciuta dal nome", () => {
  const casi = { "Nepenthes mirabilis": "nepenthes", "Chlorophytum comosum": "appartamento", "Aglio": "aglio", "Pomodori ciliegini": "pomodoro", "Melone giallo": "melone", "Melo cotogno": "fruttiferi",
    "Ficus benjamin": "ficus", "Erba cipollina": "prezzemolo", "Limone in terrazzo": "agrumi", "Tulipani rossi": "bulbose", "Dionea": "carnivora", "Monstera deliciosa": "tropicale", "Basilico genovese": "basilico", "Pianta di Marta": null, "": null,
    "Fichi": "fruttiferi", "Gerani del balcone": "geranio", "Lattughe": "lattuga", "Zucchine": "zucchina", "Ceci": "pisello", "Cavoli neri": "cavolo", "Rose rampicanti": "rosa", "Erbe aromatiche": "rosmarino", "Pianta grassa": "succulenta", "Rosso": null, "Fioriera": null };
  for (const [n, k] of Object.entries(casi)) assert.equal(M.specieDaNome(n), k, n);
  for (const k of Object.keys(M.SPECIE)) if (k !== "altro") assert.ok(M.ALIAS[k], k + ": nomi per la ricerca");
});

test("scheda dell'app per ogni specie, senza Claude", () => {
  for (const k of Object.keys(M.SPECIE)) {
    const sc = M.schedaAuto({ id: "x", nome: "X", specie: k, colt: "vaso", vaso: 2, luce: 8, dove: "aperto" }, 44);
    assert.ok(M.INFO[k] && sc.descrizione && sc.consigli.length, k + ": testi");
    for (const c of ["luce", "temperatura", "terreno", "acqua", "umidita", "concime"]) assert.ok(sc.condizioni[c], k + ": " + c);
    if (M.SPECIE[k].ann) assert.ok(sc.fasi.length >= 3 && /dalla semina/.test(sc.fasi[0].quando), k + ": fasi");
    else assert.deepEqual(Object.keys(sc.stagioni), ["inverno", "primavera", "estate", "autunno"], k + ": stagioni");
  }
  const nep = M.schedaAuto({ nome: "Nepenthes", specie: "nepenthes", colt: "vaso", vaso: 12, luce: 0, dove: "interno" }, 44);
  assert.match(nep.condizioni.concime, /Niente concime/); assert.match(nep.condizioni.acqua, /piovana/);
  const ag = M.schedaAuto({ nome: "Aglio", specie: "aglio", colt: "vaso", vaso: 30, luce: 4, dove: "aperto" }, 44);
  assert.equal(ag.fasi.find((f) => /bulbo/i.test(f.fase)).cosa.includes("smetti"), true);
  const bas = M.schedaAuto({ nome: "Basilico", specie: "basilico", colt: "vaso", vaso: 1, luce: 8, dove: "aperto", materiale: "chiuso" }, 44);
  assert.ok(bas.consigli.some((c) => /Vaso piccolo/.test(c)) && bas.consigli.some((c) => /senza fori/.test(c)), "consigli dalla pianta");
});

test("diagnosi guidata: troppa, poca, incerta, altre cause", () => {
  assert.equal(M.diagnosi(["bagnato", "appassita", "gialle_molli"]).registra, "meno");
  assert.equal(M.diagnosi(["secco", "appassita"]).registra, "piu");
  assert.equal(M.diagnosi(["bagnato", "secco"]).verdetto, "incerto");
  const nep = M.diagnosi(["punte"], { specie: "nepenthes" });
  assert.equal(nep.verdetto, "altro"); assert.match(nep.altri[0], /piovana o distillata/);
  assert.equal(M.diagnosi([]).verdetto, "bene");
});

test("sole secondo la stagione: orientamento e ore scritte un certo giorno", () => {
  assert.ok(Math.abs(M.oreSoleGeom("2026-12-21", "S", 44.2) - 6.75) < 0.3, "sud d'inverno: sole tutto il giorno");
  assert.ok(M.oreSoleGeom("2026-06-21", "S", 44.2) < M.oreSoleGeom("2026-03-21", "S", 44.2), "sud d'estate meno che all'equinozio");
  assert.equal(M.oreSoleGeom("2026-12-21", "N", 44.2), 0);
  const p = { luce: 4, orient: "E", luce_data: "2026-11-06" };
  assert.equal(M.luceOre(p, "2026-11-06", 44.2), 4); assert.ok(M.luceOre(p, "2027-06-21", 44.2) > 6, "est d'estate: più sole");
  assert.equal(M.luceOre({ luce: 4 }, "2027-06-21", 44.2), 4, "senza orientamento: numero fisso");
  // in casa la luce del giorno segue il sole previsto
  const k = M.params({ id: "c", nome: "C", specie: "appartamento", colt: "vaso", vaso: 3, luce: 6, dove: "interno" }, { oggi: "2026-11-06", lat: 44 });
  assert.ok(M.consumoL(k, { date: "2026-11-06", sole: 0 }) < M.consumoL(k, { date: "2026-11-06", sole: 0.9 }));
});

test("fasi a gradi-giorno: col freddo più piano, col caldo più in fretta; senza storico, giorni", () => {
  const p = { id: "t", nome: "Pomodoro", specie: "pomodoro", fase: "auto", data_semina: "2026-05-01", tipo_data: "semina", colt: "vaso", vaso: 20, dove: "aperto" };
  const giorni = (T) => { const st = {}; for (let i = 0; i < 400; i++) st[M.addDays("2025-10-01", i)] = T; return { storico: st, prev: {} }; };
  M.registraClima(10, null); // nessun dato per questa latitudine
  assert.equal(M.etaEquivalente(p, "2026-06-10", 10).eta, 40, "senza storico: 40 giorni");
  M.registraClima(11, giorni(15.5)); M.registraClima(12, giorni(27));
  const freddo = M.etaEquivalente(p, "2026-06-10", 11), caldo = M.etaEquivalente(p, "2026-06-10", 12);
  assert.ok(Math.abs(freddo.eta - 20) < 0.5 && freddo.ritmo === 0.5, "15,5 °C: metà velocità");
  assert.ok(caldo.eta > 60 && caldo.ritmo === 1.55, "27 °C: più veloce");
  assert.equal(M.faseEffettiva(p, "2026-06-10", 11).fase, "piantina", "freddo: ancora piantina"); assert.equal(M.faseEffettiva(p, "2026-06-10", 12).fase, "vegetativa");
  assert.ok(M.calendarioAuto(p, 11).mesi.length > M.calendarioAuto(p, 12).mesi.length, "col freddo il ciclo dura più mesi");
});

test("controllo della settimana: quando, quale pianta, cosa impara", () => {
  const piante = [{ id: "a", nome: "Aglio" }, { id: "b", nome: "Basilico" }];
  assert.equal(M.verificaDaFare(piante, [], "2026-11-06"), null, "venerdì no");
  const ev = [{ id: "1", plantId: "a", tipo: "umido", data: "2026-11-03" }];
  assert.equal(M.verificaDaFare(piante, ev, "2026-11-07").id, "b", "sabato: la pianta senza risposte recenti");
  assert.equal(M.verificaDaFare(piante, [...ev, { id: "2", plantId: "b", tipo: "verifica", data: "2026-11-07" }], "2026-11-08"), null, "già fatto questa settimana");
  assert.equal(M.esitoVerifica("secco", 0.8, 0.5), "piu"); assert.equal(M.esitoVerifica("umido", 0.3, 0.5), "meno"); assert.equal(M.esitoVerifica("umido", 0.8, 0.5), "ok");
  assert.ok(M.calibrazione([{ id: "v", plantId: "a", tipo: "verifica", valutazione: "piu", data: "2026-11-07" }], "a", "2026-11-08") > 1);
  assert.equal(M.calibrazione([{ id: "v", plantId: "a", tipo: "verifica", valutazione: "ok", data: "2026-11-07" }], "a", "2026-11-08"), 1);
});

test("meteo di riserva MET Norway: giorni locali, pioggia senza doppi conteggi, notte", () => {
  const t0 = Date.UTC(2026, 10, 6, 0), ts = [];
  for (let h = 0; h < 48; h++) ts.push({ time: new Date(t0 + h * 36e5).toISOString().replace(".000", ""), data: { instant: { details: { air_temperature: 8 + (h % 24 > 10 && h % 24 < 16 ? 6 : 0), wind_speed: 3 } },
    next_1_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 0.5 } }, next_6_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 3, air_temperature_max: 14, air_temperature_min: 8 } } } });
  for (let h = 48; h < 9 * 24; h += 6) ts.push({ time: new Date(t0 + h * 36e5).toISOString().replace(".000", ""), data: { instant: { details: { air_temperature: 10, wind_speed: 2 } },
    next_6_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 1.5, air_temperature_max: 12, air_temperature_min: 7 } } } });
  const { days, notte } = M.giorniDaMet({ properties: { timeseries: ts } }, "UTC", 44, "2026-11-06", 9);
  assert.equal(days[0].date, "2026-11-06"); assert.equal(days[0].rain, 12, "24 ore × 0,5 mm (non anche i 6 ore)");
  assert.equal(days[0].tmax, 14); assert.equal(days[0].tmin, 8); assert.equal(days[0].cond, "pioggia"); assert.ok(days[0].et0 > 0);
  assert.equal(days[3].rain, 6, "dopo due giorni: 4 × 1,5 mm ogni 6 ore"); assert.equal(days[3].cond, "nuvoloso");
  assert.ok(notte.length >= 10 && notte[0].ora === "18");
});

test("raccolta prevista: le fasi automatiche si adattano al mese scritto (es. carote seminate a novembre)", () => {
  const p = { id: "c", nome: "Carote", specie: "carota", fase: "auto", data_semina: "2026-11-06", tipo_data: "semina", colt: "vaso", vaso: 50, dove: "aperto" };
  const senza = M.calendarioAuto(p, 20).mesi, con = M.calendarioAuto({ ...p, raccolta: "2027-04" }, 20).mesi;
  assert.equal(senza.find((m) => m.raccolta).mese, "2027-01", "a giorni fissi: gennaio");
  assert.equal(con.find((m) => m.raccolta).mese, "2027-04", "con la raccolta prevista: aprile");
  assert.equal(M.faseEffettiva({ ...p, raccolta: "2027-04" }, "2027-04-20", 20).fase, "maturazione");
  assert.notEqual(M.faseEffettiva({ ...p, raccolta: "2027-04" }, "2027-01-20", 20).fase, "maturazione");
});

test("raccolta presa dalla scheda di Claude se è per la stessa semina", () => {
  const p = { specie: "carota", fase: "auto", data_semina: "2026-11-06", scheda: { specie: "carota", data_semina: "2026-11-06", calendario: [{ mese: "2027-05", raccolta: true }, { mese: "2027-04", raccolta: true }] } };
  assert.equal(M.raccoltaDi(p), "2027-04"); assert.equal(M.raccoltaDi({ ...p, raccolta: "2027-06" }), "2027-06");
  assert.equal(M.raccoltaDi({ ...p, data_semina: "2026-12-01" }), "", "scheda di un'altra semina");
});

test("messa sotto la pioggia: mm misurati (ARPAE) nelle ore scelte, litri nel vaso, riempie solo quei litri", () => {
  // misure ARPAE: chiavi in UTC alla fine dell'intervallo; a novembre l'Italia è UTC+1
  const quarti = { "2026-11-06T07:15:00Z": 0.4, "2026-11-06T07:30:00Z": 0.4, "2026-11-06T07:45:00Z": 0.4, "2026-11-06T08:00:00Z": 0.4, "2026-11-06T08:15:00Z": 2 };
  const r = M.pioggiaMisurataNelleOre({ quarti }, "2026-11-06", "08:00", "09:15", "Europe/Rome");
  assert.equal(r.mm, 3.6); assert.equal(r.fino, "09:15"); assert.equal(r.completo, true);
  const parz = M.pioggiaMisurataNelleOre({ quarti }, "2026-11-06", "08:30", "10:00", "Europe/Rome");
  assert.equal(parz.mm, 2.8, "dalle 8:30: 2 quarti + l'ultimo"); assert.equal(parz.completo, false, "misure solo fino alle 9:15");
  assert.equal(M.pioggiaMisurataNelleOre({ ore: { "2026-11-06T08:00:00Z": 6 } }, "2026-11-06", "08:30", "09:00", "Europe/Rome").mm, 3, "senza quarti: le ore");
  const p = { id: "n", nome: "Nepenthes", specie: "nepenthes", fase: "auto", colt: "vaso", vaso: 12, diametro: 30, luce: 2, dove: "serra" };
  const fut = ["2026-11-06", "2026-11-07"].map((date) => ({ date, et0: 1, tmax: 12, tmin: 8, rain: 10, prob: 90 }));
  const k = M.params(p, { oggi: "2026-11-06", lat: 44 }), litri = M.litriDaPioggia(k, 6);
  assert.ok(litri > 0.2 && litri < 0.4, "6 mm su un vaso da 30 cm ≈ 0,3 L");
  const senza = M.pianoLocale({ piante: [p], fut, oggi: "2026-11-06", lat: 44 }).piante[0].acqua;
  const con = M.pianoLocale({ piante: [p], fut, oggi: "2026-11-06", lat: 44, eventi: [{ id: "x", plantId: "n", tipo: "pioggia", data: "2026-11-06", litri }] }).piante[0].acqua;
  assert.ok(con > senza && con < 1, "più acqua nel terriccio, ma non per forza piena");
});

test("raccolta prevista rimasta prima di una nuova data di semina: non vale", () => {
  assert.equal(M.raccoltaDi({ specie: "carota", fase: "auto", data_semina: "2027-05-10", raccolta: "2027-04" }), "");
  assert.equal(M.raccoltaDi({ specie: "carota", fase: "auto", data_semina: "2026-11-06", raccolta: "2027-04" }), "2027-04");
});

/* ---------------- algoritmi: bilancio con memoria, calibrazione, crescita, più modelli ---------------- */
const serie = (da, n, extra = {}) => [...Array(n)].map((_, i) => ({ date: M.addDays(da, i), tmax: 18, tmin: 10, et0: 2, rain: 0, prob: 0, wind: 5, ...extra }));
const ev = (plantId, tipo, data, extra = {}) => ({ id: plantId + tipo + data, plantId, tipo, data, fonte: "app", ...extra });

test("bilancio con memoria: parte dall'ultima innaffiatura e la data non scivola in avanti ogni giorno", () => {
  const p = { id: "su", nome: "Aloe", specie: "succulenta", fase: "vegetativa", colt: "vaso", vaso: 2, luce: 4, dove: "interno" };
  const k = M.params(p, { oggi: "2026-11-07", lat: 44 }), c = M.consumoL(k, { date: "2026-11-07" }), giorni = Math.ceil(k.rawL / c);
  assert.ok(giorni > 10 && giorni < 100, "succulenta: innaffiatura ogni " + giorni + " giorni");
  const innaffiata = M.addDays("2026-11-07", -(giorni - 3));   // tra circa 3 giorni torna alla tacca
  const piano = (oggi) => M.pianoLocale({ piante: [p], past: serie(M.addDays(oggi, -120), 120), fut: serie(oggi, 7), eventi: [ev("su", "fatto", innaffiata)], oggi, lat: 44 }).piante[0];
  const a = piano("2026-11-07"), b = piano("2026-11-08"), prima = (x) => x.giorni.find((g) => g.azione === "innaffia")?.data;
  assert.equal(a.dal, innaffiata, "stato calcolato dall'innaffiatura");
  assert.ok(prima(a), "l'innaffiatura arriva nei prossimi giorni");
  assert.equal(prima(b), prima(a), "un giorno dopo la data resta la stessa (prima si spostava)");
  assert.ok(b.acqua < a.acqua, "e l'acqua nel terriccio cala");
  // senza nessuna innaffiatura o controllo segnato: come prima (metà tacca tre giorni fa)
  const vecchio = M.pianoLocale({ piante: [p], past: serie("2026-11-04", 3), fut: serie("2026-11-07", 7), oggi: "2026-11-07", lat: 44 }).piante[0];
  const nuovo = M.pianoLocale({ piante: [p], past: serie("2026-07-10", 120), fut: serie("2026-11-07", 7), oggi: "2026-11-07", lat: 44 }).piante[0];
  assert.equal(nuovo.acqua, vecchio.acqua); assert.equal(nuovo.dal, null);
});

test("controlli col dito: lo stato si corregge e il consumo stimato segue l'errore del calcolo", () => {
  const p = { id: "ba", nome: "Basilico", specie: "basilico", fase: "vegetativa", colt: "vaso", vaso: 3, luce: 6, dove: "riparato" };
  const k = M.params(p, { oggi: "2026-07-20", lat: 44 }), c = M.consumoL(k, { date: "2026-07-20", et0: 2, tmax: 18, wind: 5 }), giorni = k.rawL / c;
  const oggi = "2026-07-20", past = serie("2026-03-22", 120), fut = serie(oggi, 7), piano = (eventi) => M.pianoLocale({ piante: [p], past, fut, eventi, oggi, lat: 44 }).piante[0];
  // innaffiata, poi «era ancora umida» quando il calcolo la dava ben oltre la tacca → beve meno
  const t0 = M.addDays(oggi, -10), dopo = M.addDays(t0, Math.ceil(giorni * 1.6));
  const umida = [ev("ba", "fatto", t0), ev("ba", "umido", dopo)];
  const u = piano(umida);
  assert.ok(u.calibrazione < 0.85 && u.calibrazione > 0.4, "beve meno: ×" + u.calibrazione); assert.equal(u.controlli, 1);
  assert.equal(M.calibrazione(umida, "ba", oggi), u.calibrazione, "l'app e il connettore vedono la stessa stima");
  // «era asciutta» quando il calcolo la dava ancora quasi piena → beve di più
  const s = piano([ev("ba", "fatto", t0), ev("ba", "verifica", M.addDays(t0, 2), { esito: "secco" })]);
  assert.ok(s.calibrazione > 1.2, "beve di più: ×" + s.calibrazione);
  // risposta coerente con il calcolo (umida poco dopo l'innaffiatura): niente correzione
  assert.equal(piano([ev("ba", "fatto", t0), ev("ba", "umido", M.addDays(t0, 1))]).calibrazione, 1);
  // la diagnosi da foto sposta il punto di partenza
  assert.ok(piano([ev("ba", "meno", oggi)]).calibrazione < 1);
});

test("storico: archivio compatto e giorni passati con pioggia misurata ed evaporazione mancante", () => {
  const j = { daily: { time: ["2026-11-04", "2026-11-05", "2026-11-06"], temperature_2m_min: [5, 6, 7], temperature_2m_max: [12, 13, 14], precipitation_sum: [0, 4.2, 10],
    et0_fao_evapotranspiration: [1.1, null, 0.6], sunshine_duration: [18000, 0, 3600], daylight_duration: [36000, 36000, 36000], wind_speed_10m_max: [10, 20, 30] } };
  const a = M.archivioDa(j);
  assert.deepEqual(a["2026-11-04"], [5, 12, 0, 1.1, 0.5, 10]);
  const met = { lat: 44, archivio: a, days: [{ date: "2026-11-06", tmin: 7.5, tmax: 14, rain: 9, et0: 0.7 }, { date: "2026-11-07", tmin: 8, tmax: 15, rain: 0, et0: 1 }] };
  const g = M.giorniPassati(met, { giorni: { "2026-11-05": 6.4 } }, "2026-11-07");
  assert.deepEqual(g.map((d) => d.date), ["2026-11-04", "2026-11-05", "2026-11-06"], "solo i giorni passati, in ordine");
  assert.equal(g[1].rain, 6.4); assert.equal(g[1].misurata, true, "pioggia misurata ARPAE");
  assert.ok(g[1].et0 > 0, "evaporazione mancante: stimata dalle temperature");
  assert.equal(g[2].tmin, 7.5, "i giorni passati delle previsioni prevalgono sull'archivio");
});

test("crescita: ritmo ora per ora, caldo eccessivo e ore di luce", () => {
  const car = M.GRADI.carota, lat = M.GRADI.lattuga;
  assert.ok(M.ritmoGiorno({ t: 4, tmin: 0, tmax: 8 }, car) > 1.5 * M.ritmoT(4, car), "giornata fredda: le ore calde contano");
  assert.equal(M.ritmoGiorno({ t: 15.5 }, M.GRADI.pomodoro), 0.5, "con la sola media: come prima");
  assert.ok(M.ritmoGiorno({ t: 28, tmin: 20, tmax: 36 }, lat) < M.ritmoGiorno({ t: 19, tmin: 14, tmax: 24 }, lat), "lattuga: il caldo la rallenta");
  assert.equal(M.ritmoT(31, lat), 0, "oltre la massima si ferma");
  assert.ok(Math.abs(M.durataGiorno("2026-06-21", 44.2) - 15.5) < 0.15 && Math.abs(M.durataGiorno("2026-12-21", 44.2) - 8.9) < 0.15);
  assert.equal(M.primoGiornoConLuce("2027-01-01", 44.2, 13), "2027-04-07");
});

test("aglio piantato presto in un autunno caldo: il bulbo aspetta le giornate lunghe", () => {
  const st = {}; for (let d = "2026-01-01"; d <= "2027-12-31"; d = M.addDays(d, 1)) st[d] = 14;
  M.registraClima(44.31, { storico: st, prev: {} });
  const p = { id: "ag", nome: "Aglio", specie: "aglio", fase: "auto", data_semina: "2026-09-01", tipo_data: "semina", colt: "vaso", vaso: 20, dove: "aperto" };
  const feb = M.faseEffettiva(p, "2027-02-15", 44.31);
  assert.equal(feb.fase, "vegetativa", "a febbraio il caldo basterebbe, ma le giornate sono corte");
  assert.match(feb.nota, /13 ore di luce \(dal 7 aprile\)/);
  assert.equal(M.faseEffettiva(p, "2027-04-25", 44.31).fase, "fruttificazione", "da aprile ingrossa il bulbo");
  assert.equal(M.faseEffettiva({ ...p, specie: "carota" }, "2027-02-15", 44.31).fase, "maturazione", "la carota non aspetta la luce");
});

test("Kc che cresce e cala con l'età delle annuali", () => {
  const sp = M.SPECIE.pomodoro;
  assert.equal(M.kcContinuo(sp, 20), sp.kc[0]); assert.equal(M.kcContinuo(sp, 75), sp.kc[2]); assert.equal(M.kcContinuo(sp, 120), sp.kc[2]);
  assert.ok(Math.abs(M.kcContinuo(sp, 57.5) - (sp.kc[0] + sp.kc[2]) / 2) < 1e-9, "a metà sviluppo, a metà strada");
  assert.ok(M.kcContinuo(sp, 160) < sp.kc[2] && M.kcContinuo(sp, 160) > sp.kc[3]); assert.equal(M.kcContinuo(sp, 300), sp.kc[3]);
});

test("più modelli: media pesata, probabilità e modello più freddo; con un modello solo resta la base", () => {
  const days = ["2026-11-06", "2026-11-07", "2026-11-08"].map((date) => ({ date, rain: 10, prob: 80, tmax: 14, tmin: 6, et0: 1 }));
  const d = { time: ["2026-11-07", "2026-11-08"] };
  const val = { italia_meteo_arpae_icon_2i: [8, 0], ecmwf_ifs: [6, 0], gfs_seamless: [20, 0] };
  for (const [m, r] of Object.entries(val)) { d["precipitation_sum_" + m] = r; d["temperature_2m_max_" + m] = [12, 13]; d["temperature_2m_min_" + m] = m === "gfs_seamless" ? [1, 4] : [5, 6]; d["et0_fao_evapotranspiration_" + m] = [0.8, 1]; }
  const out = M.ensembleGiorni(days, { daily: d }, "2026-11-07");
  assert.equal(out[0], days[0], "i giorni passati non cambiano");
  assert.equal(out[1].rain, +((8 * 2 + 6 * 1.5 + 20 * 0.75) / 4.25).toFixed(1), "oggi: ICON-2I pesa di più di GFS");
  assert.equal(out[1].prob, 90, "(80% di Open-Meteo + 100% dei modelli) / 2"); assert.equal(out[2].prob, 40);
  assert.equal(out[1].tmin_freddo, 2, "il modello più freddo + 1 °C"); assert.equal(out[1].et0, 0.8);
  assert.deepEqual(out[1].rain_modelli, [8, 6, 20]); assert.equal(M.pioggiaAttesa(out[1]), out[1], "la media è già il valore atteso");
  const uno = M.ensembleGiorni(days, { daily: { time: d.time, precipitation_sum_ecmwf_ifs: [6, 0] } }, "2026-11-07");
  assert.equal(uno[1].rain, 10, "un modello solo: resta la previsione di base");
  // avviso del gelo: conta anche il modello più freddo
  const limone = { id: "l", nome: "Limone", specie: "agrumi", colt: "vaso", dove: "aperto" };
  assert.equal(M.avvisiDomani([limone], { tmin: 7, tmax: 14 }).length, 0);
  assert.match(M.avvisiDomani([limone], { tmin: 7, tmin_freddo: 4.5, tmax: 14 })[0].testo, /secondo il modello più freddo \(gli altri 7 °C\)/);
});

test("sotto la pioggia di notte: dalle 17:28 di ieri alle 07:15 di oggi", () => {
  // novembre: Italia = UTC+1. Pioggia ieri 20:00–21:00 (2 mm), oggi 03:00–04:00 (1,2 mm), ieri 15:00 (fuori, 5 mm)
  const ore = { "2026-11-07T14:00:00Z": 5, "2026-11-07T20:00:00Z": 2, "2026-11-08T03:00:00Z": 1.2, "2026-11-08T07:00:00Z": 0 };
  const r = M.pioggiaMisurataNelleOre({ ore }, "2026-11-08", "17:28", "07:15", "Europe/Rome");
  assert.equal(r.mm, 3.2); assert.equal(r.notte, true); assert.equal(r.completo, true);
  assert.equal(M.pioggiaMisurataNelleOre({ ore }, "2026-11-08", "07:00", "07:00", "Europe/Rome").mm, 0, "stessa ora: niente");
  assert.equal(M.pioggiaMisurataNelleOre({ ore }, "2026-11-08", "02:00", "05:00", "Europe/Rome").mm, 1.2, "di giorno come prima");
});

test("pianta di casa fuori per più giorni: pioggia misurata giorno per giorno, totali per i giorni più vecchi", () => {
  // novembre: Italia = UTC+1. Ore misurate dal 5 all'8; per i giorni prima solo i totali del giorno
  const ore = { "2026-11-05T10:00:00Z": 3, "2026-11-06T22:00:00Z": 1, "2026-11-06T23:00:00Z": 2, "2026-11-07T08:00:00Z": 4, "2026-11-08T06:00:00Z": 0 };
  const giorni = { "2026-11-02": 6, "2026-11-03": 0, "2026-11-04": 1.5 };
  const r = M.pioggiaMisurataTra({ ore, giorni }, { d: "2026-11-02", t: "00:00" }, { d: "2026-11-08", t: "07:00" }, "Europe/Rome");
  // 23:00 UTC del 6 = mezzanotte del 7: quell'ora (23–24 locali del 6) resta al 6
  assert.deepEqual(r.giorni, { "2026-11-02": 6, "2026-11-04": 1.5, "2026-11-05": 3, "2026-11-06": 3, "2026-11-07": 4 });
  assert.equal(r.mm, 17.5); assert.equal(r.conTotali, true); assert.deepEqual(r.senzaDati, []); assert.equal(r.completo, true);
  // il primo giorno a metà senza misure ora per ora non si conta (non si sa a che ora pioveva): lo dice
  const meta = M.pioggiaMisurataTra({ ore, giorni }, { d: "2026-11-02", t: "12:00" }, { d: "2026-11-05", t: "23:00" }, "Europe/Rome");
  assert.deepEqual(meta.senzaDati, ["2026-11-02"]); assert.equal(meta.mm, 4.5); assert.equal(meta.completo, false);
  // fino a dove arrivano le misure, e un intervallo al contrario non conta niente
  const oltre = M.pioggiaMisurataTra({ ore }, { d: "2026-11-07", t: "08:00" }, { d: "2026-11-08", t: "12:00" }, "Europe/Rome");
  assert.equal(oltre.mm, 4); assert.equal(oltre.completo, false); assert.deepEqual(oltre.ultima, { d: "2026-11-08", t: "07:00" });
  assert.equal(M.pioggiaMisurataTra({ ore }, { d: "2026-11-08", t: "07:00" }, { d: "2026-11-07", t: "07:00" }, "Europe/Rome").mm, 0);
  // nel bilancio: un evento per giorno, ognuno nel suo giorno
  const p = { id: "n", nome: "Nepenthes", specie: "nepenthes", fase: "auto", colt: "vaso", vaso: 12, diametro: 30, luce: 2, dove: "interno" };
  const presa = M.pioggiaPresa(p, Object.entries(r.giorni).map(([data, mm], i) => ({ id: "p" + i, plantId: "n", tipo: "pioggia", data, litri: +(mm * 0.05).toFixed(2) })));
  assert.deepEqual(Object.keys(presa).sort(), ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
});

test("verso dove guarda: anche più direzioni (balcone d'angolo)", () => {
  assert.equal(M.orientamento("O, S"), "S,O"); assert.equal(M.orientamento("S,aperto"), "aperto"); assert.equal(M.orientamento("boh"), ""); assert.equal(M.orientamento("S"), "S");
  assert.equal(M.nomeOrientamento("S,O"), "verso sud e ovest"); assert.equal(M.nomeOrientamento("E,S,O"), "verso est, sud e ovest");
  for (const d of ["2026-12-21", "2026-06-21"]) {
    const s = M.oreSoleGeom(d, "S", 44), o = M.oreSoleGeom(d, "O", 44), so = M.oreSoleGeom(d, "S,O", 44), ap = M.oreSoleGeom(d, "aperto", 44);
    assert.ok(so >= Math.max(s, o) && so <= ap, `${d}: sud ${s}, ovest ${o}, angolo ${so}, aperto ${ap}`);
    assert.equal(M.oreSoleGeom(d, "O,S", 44), so, "l'ordine non conta");
  }
  // le ore scritte d'inverno su un angolo sud-ovest crescono d'estate come la geometria dell'angolo
  const p = { luce: 5, orient: "S,O", luce_data: "2026-12-21" };
  assert.ok(M.luceOre(p, "2027-06-21", 44) > 5);
});

test("semi in germinazione: bagnatura leggera quando la superficie si asciuga, anche se il vaso è pieno", () => {
  const oggi = "2026-11-08", carote = { id: "c", nome: "Carote", specie: "carota", fase: "auto", data_semina: "2026-11-06", tipo_data: "semina", colt: "vaso", vaso: 50, diametro: 50, num: 14, luce: 4, dove: "aperto", materiale: "terracotta" };
  const aglio = { ...carote, id: "a", nome: "Aglio", specie: "aglio", data_semina: "2026-11-03", num: 4 };
  const giorno = (date, rain, et0) => ({ date, tmax: 14, tmin: 6, et0, rain, prob: rain ? 90 : 5, wind: 8, sole: 0.5 });
  const past = Array.from({ length: 10 }, (_, i) => giorno(M.addDays(oggi, i - 10), i === 9 ? 8 : 0, 1.1));
  const fut = (et0, pioggia) => Array.from({ length: 7 }, (_, i) => giorno(M.addDays(oggi, i), pioggia && (i === 2 || i === 5) ? 10 : 0, et0));
  const eventi = [{ id: "v", plantId: "c", tipo: "verifica", esito: "umido", data: oggi }];
  const piano = (f) => M.pianoLocale({ piante: [carote, aglio], past, fut: f, eventi, oggi, lat: 44 });
  const sec = piano(fut(1.1, false)), c = sec.piante.find((x) => x.id === "c"), a = sec.piante.find((x) => x.id === "a");
  const bagnate = c.giorni.filter((g) => g.azione === "innaffia");
  assert.equal(bagnate.length, 1, "una settimana asciutta di novembre: una bagnatura leggera");
  assert.ok(bagnate[0].litri < 1 && /germinazione/.test(bagnate[0].motivo), "poca acqua, solo la superficie (" + bagnate[0].litri + " L)");
  assert.ok(c.acqua > 0.9, "il vaso intero è ancora quasi pieno");
  assert.ok(!a.giorni.some((g) => g.azione === "innaffia"), "aglio: lo spicchio è sotto, niente bagnature di superficie");
  assert.ok(piano(fut(3, false)).piante.find((x) => x.id === "c").giorni.filter((g) => g.azione === "innaffia").length >= 3, "col caldo più spesso");
  assert.equal(piano(fut(1.1, true)).piante.find((x) => x.id === "c").giorni.filter((g) => g.azione === "innaffia").length, 0, "la pioggia bagna la superficie");
});
