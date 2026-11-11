const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = ['1', '2', '3', '4'];
const socket = io();
const key = new URLSearchParams(location.search).get('key') || '';
const joinUrl = location.origin + '/';
let state = null;
let tick = null;
let lastQ = 0;
let count = 10;
let overlay = null; // 'qr' | 'rank' | null

// QR 코드 / 참가자 순위 창
function paintOverlay() {
  const box = $('overlay');
  box.classList.toggle('hidden', !overlay);
  $('panel').classList.toggle('wide', overlay === 'age');
  if (!overlay || !state) return;
  const close = '<div class="foot"><button class="btn" data-act="close">닫기</button></div>';
  if (overlay === 'qr') {
    $('panel').innerHTML = `<h2>📱 QR로 입장하세요</h2>
      <div class="qrbox big"><img src="/qr.svg" alt="QR"><div class="url">${esc(joinUrl)}</div></div>${close}`;
  } else if (overlay === 'age') {
    const f = state.ageFast;
    const times = f.rows.filter((r) => r.best).map((r) => r.best.ms);
    const top = times.length ? Math.min(...times) : null;
    const cards = f.rows.map((r, i) => {
      const b = r.best;
      const champ = b && b.ms === top;
      const now = r.now
        ? `<b>${esc(r.now.name)}</b> ${sec(r.now.ms)}`
        : '<span class="none">정답자 없음</span>';
      return `<div class="agecard a${i} ${b ? '' : 'empty'} ${champ ? 'champ' : ''}">
        <div class="agehead">${esc(r.age)}${champ ? '<span class="crown">👑</span>' : ''}</div>
        <div class="agebody">
          ${b ? `<div class="agename">${esc(b.name)}</div>
                 <div class="agetime">⚡ ${sec(b.ms)}</div>
                 <div class="ageq">${b.q}번 문제에서 기록</div>`
              : `<div class="agename none">—</div><div class="ageq">아직 정답자가 없습니다</div>`}
        </div>
        <div class="agenow"><span>${f.lastQ ? f.lastQ + '번 문제' : '이번 문제'}</span>${now}</div>
      </div>`;
    }).join('');
    $('panel').innerHTML = `<h2>⚡ 연령대별 가장 빠른 정답자</h2>
      <div class="agegrid">${cards}</div>${close}`;
  } else {
    const rows = state.ranking.map((t) =>
      `<tr><td>${t.rank}</td><td>${esc(t.name)}</td><td>${esc(t.age)}</td><td>${t.correct}문제</td><td>${t.score.toLocaleString()}점</td></tr>`).join('');
    $('panel').innerHTML = `<h2>🏅 참가자 순위 (${state.ranking.length}명)</h2>
      <div class="tablewrap"><table class="rank"><thead><tr><th>순위</th><th>이름</th><th>연령대</th><th>정답</th><th>점수</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">아직 참가자가 없습니다</td></tr>'}</tbody></table></div>${close}`;
  }
}
$('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') { overlay = null; paintOverlay(); } });

socket.on('connect', () => {
  socket.emit('host:hello', key, (res) => {
    if (!res.ok) $('main').innerHTML = '<div class="qtitle">진행자 비밀번호가 필요합니다.<br>주소 뒤에 ?key=비밀번호 를 붙여 주세요.</div>';
  });
});
socket.on('answered', (n) => { const el = $('answered'); if (el) el.textContent = n; });
socket.on('state', (s) => { state = s; render(); paintOverlay(); });

// 버튼 처리 (화면이 다시 그려져도 동작하도록 한 곳에서 처리)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  Player.unlock();
  const act = b.dataset.act;
  if (act === 'start') socket.emit('host:start', count);
  if (act === 'next') socket.emit('host:next');
  if (act === 'reveal') socket.emit('host:reveal');
  if (act === 'replay' && state) Player.play(state.audio);
  if (act === 'again') socket.emit('host:again');
  if (act === 'qr' || act === 'rank' || act === 'age') { overlay = act; paintOverlay(); }
  if (act === 'close') { overlay = null; paintOverlay(); }
  if (act === 'home' && confirm('진행 중인 퀴즈를 멈추고 처음 화면(QR 대기 화면)으로 돌아갈까요?\n참가자는 그대로 유지됩니다.')) socket.emit('host:again');
  if (act === 'reset' && confirm('참가자 명단까지 모두 지우고 처음으로 돌아갈까요?')) socket.emit('host:reset');
});
document.addEventListener('change', (e) => { if (e.target.id === 'count') count = Number(e.target.value); });

const chips = (players) => players.map((p) =>
  `<span class="chip ${p.connected ? '' : 'off'}">${esc(p.name)}<small>${esc(p.age)}</small></span>`).join('');
const sec = (ms) => (ms / 1000).toFixed(2) + '초';

function render() {
  const s = state;
  clearInterval(tick);
  const main = $('main');
  $('hinfo').textContent = s.phase === 'lobby' || s.phase === 'final'
    ? `참가자 ${s.players.length}명` : `${s.qNumber} / ${s.qTotal} 번 문제 · 참가자 ${s.players.length}명`;

  if (s.phase === 'lobby') {
    lastQ = 0;
    count = Math.min(count, s.totalHymns);
    const opts = [5, 10, 15, 20, s.totalHymns].filter((n, i, a) => n <= s.totalHymns && a.indexOf(n) === i)
      .map((n) => `<option value="${n}" ${n === count ? 'selected' : ''}>${n}문제</option>`).join('');
    main.innerHTML = `
      <div class="lobby">
        <div class="qrbox"><img src="/qr.svg" alt="QR"><div class="url">${esc(joinUrl)}</div></div>
        <div>
          <h1>찬송가 첫 소절 퀴즈</h1>
          <p class="how">① 휴대폰 카메라로 QR을 찍어 주세요<br>② 이름과 연령대를 입력하고 입장<br>③ 첫 소절을 듣고 가장 빨리 정답을 누르면 승리!</p>
          <h3 style="font-size:1.5rem">입장한 사람 ${s.players.length}명</h3>
          <div class="chips">${chips(s.players) || '<span style="opacity:.6;font-size:1.3rem">아직 아무도 없습니다…</span>'}</div>
          <div class="row">
            <select id="count">${opts}</select>
            <button class="btn" data-act="start" ${s.players.length ? '' : 'disabled'}>퀴즈 시작</button>
            <button class="btn ghost" data-act="reset">참가자 초기화</button>
          </div>
        </div>
      </div>`;
  } else if (s.phase === 'question') {
    main.innerHTML = `
      <div class="qtitle">이 찬송가는 무엇일까요?</div>
      <div class="note">🎶</div>
      <div class="timer" id="timer"></div>
      <div class="grid4">${s.choices.map((c, i) =>
        `<div class="choice c${i}"><span class="n">${MARK[i]}</span><span>${esc(c)}</span></div>`).join('')}</div>
      <div class="meta">
        <span>답한 사람 <span id="answered">${s.answered}</span> / ${s.players.length}명</span>
        <span class="row"><button class="btn ghost" data-act="replay">🔁 다시 듣기</button>
        <button class="btn ghost" data-act="reveal">정답 공개</button></span>
      </div>`;
    const t0 = Date.now() - s.elapsed;
    const paint = () => { const el = $('timer'); if (el) el.textContent = Math.max(0, Math.ceil((s.timeLimit - (Date.now() - t0)) / 1000)); };
    paint();
    tick = setInterval(paint, 200);
    if (lastQ !== s.qNumber) { lastQ = s.qNumber; Player.play(s.audio); } // 새 문제일 때만 자동 재생
  } else if (s.phase === 'reveal') {
    Player.stop();
    const r = s.result;
    const w = r.winner;
    const last = s.qNumber >= s.qTotal;
    main.innerHTML = `<div class="reveal">
      <div class="winner">
        ${w ? `<div class="crown">👑 가장 빠른 정답자</div>
               <div class="name">${esc(w.name)}</div>
               <div class="info">${esc(w.age)} · ${sec(w.ms)}</div>`
            : `<div class="crown">😮</div><div class="name">정답자가 없습니다</div>`}
      </div>
      <div class="grid4">${s.choices.map((c, i) =>
        `<div class="choice c${i} ${i === r.answer ? '' : 'dim'}"><span class="n">${i === r.answer ? '✔' : MARK[i]}</span><span>${esc(c)}</span><span class="cnt">${r.counts[i]}명</span></div>`).join('')}</div>
      <div class="cols">
        <div class="list card"><h3>⚡ 빠른 정답 순위 (정답 ${r.correctCount}명 / 응답 ${r.answeredCount}명)</h3>
          <ol>${r.fastest.slice(0, 3).map((f, i) => `<li><span>${i + 1}. ${esc(f.name)}<small>${esc(f.age)}</small></span><span>${sec(f.ms)}</span></li>`).join('') || '<li>없음</li>'}</ol></div>
        <div class="list card"><h3>🏅 종합 점수</h3>
          <ol>${r.top.slice(0, 3).map((t) => `<li><span>${t.rank}. ${esc(t.name)}<small>${esc(t.age)}</small></span><span>${t.score.toLocaleString()}점</span></li>`).join('')}</ol></div>
      </div>
      <div class="foot"><button class="btn ghost" data-act="age">⚡ 연령대별 가장 빠른 사람</button>
      <button class="btn" data-act="next">${last ? '최종 결과 보기' : '다음 문제 ▶'}</button></div></div>`;
  } else if (s.phase === 'final') {
    Player.stop();
    const medal = ['🥇', '🥈', '🥉'];
    main.innerHTML = `
      <div class="podium"><h1>🏆 최종 결과</h1></div>
      <div class="cols">
        <div class="list card"><h3>종합 순위</h3>
          <ol>${s.ranking.slice(0, 10).map((t) => `<li><span>${medal[t.rank - 1] || t.rank + '.'} ${esc(t.name)}<small>${esc(t.age)}</small></span><span>${t.correct}문제 · ${t.score.toLocaleString()}점</span></li>`).join('')}</ol></div>
        <div class="list card"><h3>연령대별 1등</h3>
          <ol>${s.byAge.map((g) => `<li><span>${esc(g.age)}</span><span>${esc(g.top.name)} · ${g.top.score.toLocaleString()}점</span></li>`).join('')}</ol></div>
      </div>
      <div class="foot"><button class="btn" data-act="again">같은 참가자로 다시 하기</button>
      <button class="btn ghost" data-act="age">⚡ 연령대별 가장 빠른 사람</button>
      <button class="btn ghost" data-act="reset">처음으로 (참가자 초기화)</button></div>`;
  }
}
