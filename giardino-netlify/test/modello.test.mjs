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
