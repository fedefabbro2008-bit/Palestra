// genera uno storico realistico (nel contesto della pagina): weeks settimane, 3 sedute a settimana, qualche riserva
function seedLogs(opts) {
  const { weeks = 10, nowTs } = opts || {};
  const days = JSON.parse(localStorage.getItem('palestra:days'));
  const main = Object.keys(days).filter(k => !days[k].spare), spare = Object.keys(days).filter(k => days[k].spare);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const now = new Date(nowTs || Date.now());
  const logs = {};
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const baseKg = { Petto: 40, Schiena: 45, Spalle: 12, Bicipiti: 10, Tricipiti: 15, Addominali: 20, Glutei: 0, Femorale: 0, Altro: 0 };
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * (weeks - 1));
  let rot = 0, n = 0;
  for (let w = 0; w < weeks; w++) {
    [0, 2, 4].forEach((off, j) => {
      const d = new Date(monday); d.setDate(d.getDate() + off + 7 * w);
      if (d > now) return;
      if (rnd() < 0.08) return; // seduta saltata
      const due = main[rot % main.length];
      const useSpare = spare.length && rnd() < 0.12;
      const key = useSpare ? spare[Math.floor(rnd() * spare.length)] : due;
      rot++;
      const day = days[key];
      let t = new Date(d); t.setHours(18, Math.floor(rnd() * 30), 0, 0); t = t.getTime();
      const startedAt = t;
      const entries = [];
      day.exercises.forEach(e => {
        const detail = [];
        const kg0 = e.muscle === 'Altro' ? 0 : (baseKg[e.muscle] || 0);
        const kg = kg0 ? Math.round((kg0 + w * (kg0 > 20 ? 2.5 : 1)) * 2) / 2 : 0;
        const nw = e.warmups || 0, ns = e.sets || 0;
        for (let i = 0; i < nw; i++) { t += 60000; detail.push({ kg: kg ? Math.round(kg * 0.5) : 0, val: e.type === 'time' ? 60 : 10, at: t, w: true }); }
        for (let i = 0; i < ns; i++) {
          t += (e.rest || 60) * 1000 + 35000 + Math.floor(rnd() * 30000);
          const val = e.type === 'time' ? 30 + Math.floor(rnd() * 15) : 8 + Math.floor(rnd() * 5);
          const dd = { kg, val, at: t };
          if (e.muscle !== 'Altro' && i === ns - 1 && rnd() < 0.15) dd.t = 'f';
          if (opts.rpe && e.muscle !== 'Altro') dd.rpe = 7 + Math.floor(rnd() * 3);
          detail.push(dd);
        }
        t += 90000;
        if (!detail.length) return;
        entries.push({ exId: e.id, name: e.name, muscle: e.muscle, secondary: e.secondary, type: e.type, sets: detail.filter(x => !x.w).length, kg, val: Math.max(...detail.map(x => x.val)), detail });
      });
      if (t > now.getTime()) return; // la seduta di oggi c'è solo se è già finita (al mattino non ancora)
      const s = { id: 'seed' + (n++), dayKey: key, dayName: day.name, startedAt, endedAt: t, note: rnd() < 0.15 ? 'Buona seduta, un po\' stanco alla fine' : '', entries };
      if (useSpare) s.forDay = due;
      (logs[iso(d)] = logs[iso(d)] || []).push(s);
    });
  }
  localStorage.setItem('palestra:logs', JSON.stringify(logs));
  return n;
}
module.exports = { seedLogs };
