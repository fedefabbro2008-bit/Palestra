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
