const AGES = ['30대 이하', '40대', '50대', '60대', '70대', '80대 이상'];
const MARK = ['1', '2', '3', '4'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const socket = io();

let pid = localStorage.getItem('hq_pid');
if (!pid) {
  pid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('hq_pid', pid);
}
let age = localStorage.getItem('hq_age') || '';
let joined = false;
let barTimer = null;

$('name').value = localStorage.getItem('hq_name') || '';
$('ages').innerHTML = AGES.map((a) => `<button type="button" class="age" data-age="${a}">${a}</button>`).join('');
const paintAges = () => document.querySelectorAll('.age').forEach((b) => b.classList.toggle('on', b.dataset.age === age));
paintAges();
$('ages').addEventListener('click', (e) => {
  const b = e.target.closest('.age');
  if (b) { age = b.dataset.age; paintAges(); }
});

function showGame(on) {
  joined = on;
  $('v-join').classList.toggle('hidden', on);
  $('v-game').classList.toggle('hidden', !on);
}
showGame(false);

$('joinBtn').addEventListener('click', () => {
  const name = $('name').value.trim();
  if (!name) return ($('err').textContent = '이름을 입력해 주세요.');
  if (!age) return ($('err').textContent = '연령대를 선택해 주세요.');
  $('err').textContent = '';
  socket.emit('join', { id: pid, name, age }, (res) => {
    if (!res.ok) return ($('err').textContent = res.error || '입장할 수 없습니다.');
    localStorage.setItem('hq_name', name);
    localStorage.setItem('hq_age', age);
    showGame(true);
  });
});

// 새로고침 / 화면이 꺼졌다 켜졌을 때 자동 재입장
socket.on('connect', () => {
  socket.emit('resume', pid, (res) => { if (res.ok) showGame(true); else showGame(false); });
});
socket.on('kicked', () => showGame(false));

const center = (emoji, big, mid = '') =>
  `<div class="center"><div class="emoji">${emoji}</div><div class="big">${big}</div><div class="mid">${mid}</div></div>`;

socket.on('state', (s) => {
  if (!joined) return;
  clearInterval(barTimer);
  $('meName').textContent = s.me.name;
  $('meAge').textContent = `(${s.me.age})`;
  $('meScore').textContent = s.me.score.toLocaleString();
  const body = $('body');

  if (s.phase === 'lobby') {
    body.innerHTML = center('🙌', '입장 완료!', '앞 화면을 보며<br>시작을 기다려 주세요');
  } else if (s.phase === 'question') {
    if (s.myChoice !== null) {
      body.innerHTML = center('⏳', '답을 보냈습니다', `내가 고른 답<br><b>${esc(s.choices[s.myChoice])}</b>`);
      return;
    }
    body.innerHTML =
      `<div class="qhead">${s.qNumber} / ${s.qTotal} 번 문제 · 어떤 찬송가일까요?</div>
       <div class="bar"><i id="bar"></i></div>
       <div class="choices">${s.choices.map((c, i) =>
         `<button class="choice c${i}" data-i="${i}"><span class="n">${MARK[i]}</span><span>${esc(c)}</span></button>`).join('')}</div>`;
    const t0 = Date.now() - s.elapsed;
    barTimer = setInterval(() => {
      const left = Math.max(0, 1 - (Date.now() - t0) / s.timeLimit);
      const bar = $('bar');
      if (bar) bar.style.width = left * 100 + '%';
    }, 100);
    body.querySelectorAll('.choice').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        socket.emit('answer', i);
        body.innerHTML = center('⏳', '답을 보냈습니다', `내가 고른 답<br><b>${esc(s.choices[i])}</b>`);
      }));
  } else if (s.phase === 'reveal') {
    const r = s.myResult;
    const ans = `정답: <b>${esc(s.choices[s.result.answer])}</b>`;
    const win = s.result.winner ? `<br>가장 빠른 정답자: <b>${esc(s.result.winner.name)}</b>` : '';
    if (r.correct) body.innerHTML = center('🎉', `정답! +${r.gained}점`, `${(r.ms / 1000).toFixed(2)}초 만에 맞혔어요<br>${ans}${win}`);
    else if (r.ms === null) body.innerHTML = center('⌛', '시간 초과', ans + win);
    else body.innerHTML = center('😢', '아쉬워요', ans + win);
  } else if (s.phase === 'final') {
    body.innerHTML = center('🏆', `${s.playerCount}명 중 ${s.myRank}등`,
      `${s.me.correct}문제 정답 · ${s.me.score.toLocaleString()}점<br>수고하셨습니다!`);
  }
});
