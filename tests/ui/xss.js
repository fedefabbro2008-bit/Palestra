// payload in tutti i campi di testo: se qualcosa viene interpretato come HTML, __xss cresce o compare un <img data-x>
const P = (tag) => `"'><img data-x src=x onerror="window.__xss=(window.__xss||[]).concat('${tag}')"><svg/onload="window.__xss=(window.__xss||[]).concat('${tag}s')"></textarea></title></style><b data-x>${tag}`;
function poison(P) {
  const days = JSON.parse(localStorage.getItem('palestra:days'));
  const logs = JSON.parse(localStorage.getItem('palestra:logs'));
  // scheda: nomi, ripetizioni, id
  Object.values(days).forEach((d, i) => { d.name = P('day' + i) + ' · ' + P('focus' + i); d.exercises.forEach((e, j) => { e.name = P('ex' + i + '_' + j); e.reps = '8-12' + (j === 1 ? P('reps') : ''); if (j === 2) e.id = P('exid'); }); });
  // storico: nomi, note, id, giornate
  Object.values(logs).forEach(arr => arr.forEach((s, i) => { s.note = P('note'); s.dayName = P('dayName'); if (i === 0) { s.id = P('sid'); s.forDay = P('forDay'); } s.entries.forEach((e, j) => { e.name = P('entry' + j); if (j === 0) e.exId = P('exId'); }); }));
  const k = Object.keys(logs)[0]; logs[k][0].dayKey = P('dayKey');
  const st = JSON.parse(localStorage.getItem('palestra:settings'));
  st.aiContext = P('ai'); st.lastDay = '<b data-x>x</b>';
  localStorage.setItem('palestra:days', JSON.stringify(days));
  localStorage.setItem('palestra:logs', JSON.stringify(logs));
  localStorage.setItem('palestra:settings', JSON.stringify(st));
  localStorage.setItem('palestra:timer', JSON.stringify({ label: P('timer'), duration: 90, remaining: 60, running: false, paused: true }));
}
module.exports = { P, poison };
