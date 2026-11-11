const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const HYMNS = require('./hymns');

const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || ''; // 설정하면 /host?key=값 으로만 진행 화면 접속 가능
const TIME_LIMIT_MS = Number(process.env.TIME_LIMIT_SEC || 20) * 1000;
const AGE_GROUPS = ['30대 이하', '40대', '50대', '60대', '70대', '80대 이상'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/qr.svg', async (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${proto}://${req.headers.host}/`;
  res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1, width: 400 }));
});

// ---------------- 게임 상태 (서버 1대 = 게임 1개) ----------------
const game = {
  phase: 'lobby', // lobby | question | reveal | final
  players: new Map(), // id -> { id, name, age, score, correct, connected, socketId }
  questions: [],
  qIndex: -1,
  startedAt: 0,
  answers: new Map(), // playerId -> { choice, ms }
  timer: null,
  lastResult: null,
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const label = (h) => `${h.no}장 ${h.title}`;

function buildQuestions(count) {
  return shuffle(HYMNS).slice(0, count).map((h) => {
    const wrong = shuffle(HYMNS.filter((x) => x.no !== h.no)).slice(0, 3);
    const choices = shuffle([h, ...wrong]);
    return { hymn: h, choices: choices.map(label), answer: choices.indexOf(h) };
  });
}

const ranking = () =>
  [...game.players.values()]
    .sort((a, b) => b.score - a.score || b.correct - a.correct)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, age: p.age, score: p.score, correct: p.correct }));

function baseState() {
  const q = game.questions[game.qIndex];
  return {
    phase: game.phase,
    qNumber: game.qIndex + 1,
    qTotal: game.questions.length,
    choices: q && game.phase !== 'lobby' && game.phase !== 'final' ? q.choices : null,
    timeLimit: TIME_LIMIT_MS,
    elapsed: game.phase === 'question' ? Date.now() - game.startedAt : 0,
    result: game.phase === 'reveal' ? game.lastResult : null,
  };
}

function hostState() {
  const q = game.questions[game.qIndex];
  const s = baseState();
  if (s.result) s.result = { ...s.result, perPlayer: undefined };
  s.players = [...game.players.values()].map((p) => ({ name: p.name, age: p.age, connected: p.connected }));
  s.answered = game.answers.size;
  s.totalHymns = HYMNS.length;
  if (q && game.phase === 'question') {
    const { notes, bpm, audio, start, duration } = q.hymn;
    s.audio = { notes, bpm, audio, start, duration };
  }
  if (game.phase === 'final') {
    const rank = ranking();
    s.ranking = rank;
    s.byAge = AGE_GROUPS.map((age) => ({ age, top: rank.find((r) => r.age === age) || null })).filter((g) => g.top);
  }
  return s;
}

function playerState(p) {
  const s = baseState();
  s.me = { name: p.name, age: p.age, score: p.score, correct: p.correct };
  const a = game.answers.get(p.id);
  s.myChoice = a ? a.choice : null;
  if (game.phase === 'reveal' && game.lastResult) {
    s.myResult = game.lastResult.perPlayer[p.id] || { correct: false, gained: 0, ms: null };
    s.result = { answer: game.lastResult.answer, winner: game.lastResult.winner };
  }
  if (game.phase === 'final') {
    const r = ranking();
    s.myRank = (r.find((x) => x.id === p.id) || {}).rank;
    s.playerCount = r.length;
  }
  return s;
}

function broadcast() {
  io.to('host').emit('state', hostState());
  for (const p of game.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', playerState(p));
  }
}

function startQuestion() {
  clearTimeout(game.timer);
  game.qIndex += 1;
  if (game.qIndex >= game.questions.length) {
    game.phase = 'final';
    return broadcast();
  }
  game.phase = 'question';
  game.answers = new Map();
  game.startedAt = Date.now();
  game.timer = setTimeout(reveal, TIME_LIMIT_MS + 500);
  broadcast();
}

function reveal() {
  if (game.phase !== 'question') return;
  clearTimeout(game.timer);
  const q = game.questions[game.qIndex];
  const perPlayer = {};
  const correctList = [];
  for (const [id, a] of game.answers) {
    const p = game.players.get(id);
    if (!p) continue;
    const correct = a.choice === q.answer;
    let gained = 0;
    if (correct) {
      // 정답 500점 + 빠를수록 최대 500점 추가
      gained = Math.round(500 + 500 * Math.max(0, 1 - a.ms / TIME_LIMIT_MS));
      p.score += gained;
      p.correct += 1;
      correctList.push({ name: p.name, age: p.age, ms: a.ms });
    }
    perPlayer[id] = { correct, gained, ms: a.ms };
  }
  correctList.sort((a, b) => a.ms - b.ms);
  const counts = [0, 0, 0, 0];
  for (const a of game.answers.values()) counts[a.choice] += 1;
  game.lastResult = {
    answer: q.answer,
    answerLabel: q.choices[q.answer],
    winner: correctList[0] || null, // 가장 빨리 맞힌 사람
    fastest: correctList.slice(0, 5),
    correctCount: correctList.length,
    answeredCount: game.answers.size,
    counts,
    top: ranking().slice(0, 5),
    perPlayer,
  };
  game.phase = 'reveal';
  broadcast();
}

function resetGame(keepPlayers) {
  clearTimeout(game.timer);
  game.phase = 'lobby';
  game.questions = [];
  game.qIndex = -1;
  game.answers = new Map();
  game.lastResult = null;
  if (keepPlayers) {
    for (const p of game.players.values()) Object.assign(p, { score: 0, correct: 0 });
  } else {
    game.players.clear();
    io.to('players').emit('kicked');
  }
  broadcast();
}

io.on('connection', (socket) => {
  // ----- 진행자(메인 화면) -----
  socket.on('host:hello', (key, ack) => {
    if (HOST_KEY && key !== HOST_KEY) return ack && ack({ ok: false });
    socket.join('host');
    socket.data.host = true;
    ack && ack({ ok: true });
    socket.emit('state', hostState());
  });
  const hostOnly = (fn) => (...args) => socket.data.host && fn(...args);

  socket.on('host:start', hostOnly((count) => {
    if (game.players.size === 0) return;
    const n = Math.max(1, Math.min(Number(count) || 10, HYMNS.length));
    for (const p of game.players.values()) Object.assign(p, { score: 0, correct: 0 });
    game.questions = buildQuestions(n);
    game.qIndex = -1;
    startQuestion();
  }));
  socket.on('host:next', hostOnly(() => game.phase === 'reveal' && startQuestion()));
  socket.on('host:reveal', hostOnly(() => reveal()));
  socket.on('host:again', hostOnly(() => resetGame(true))); // 같은 참가자로 다시
  socket.on('host:reset', hostOnly(() => resetGame(false))); // 참가자까지 초기화

  // ----- 참가자 -----
  socket.on('join', ({ id, name, age } = {}, ack) => {
    name = String(name || '').trim().slice(0, 12);
    if (!id || !name || !AGE_GROUPS.includes(age)) return ack && ack({ ok: false, error: '이름과 연령대를 확인해 주세요.' });
    let p = game.players.get(id);
    if (!p) {
      p = { id, name, age, score: 0, correct: 0, connected: true, socketId: socket.id };
      game.players.set(id, p);
    } else {
      Object.assign(p, { name, age, connected: true, socketId: socket.id });
    }
    socket.data.playerId = id;
    socket.join('players');
    ack && ack({ ok: true });
    broadcast();
  });

  // 새로고침·화면 꺼짐 후 자동 재접속
  socket.on('resume', (id, ack) => {
    const p = game.players.get(id);
    if (!p) return ack && ack({ ok: false });
    Object.assign(p, { connected: true, socketId: socket.id });
    socket.data.playerId = id;
    socket.join('players');
    ack && ack({ ok: true });
    broadcast();
  });

  socket.on('answer', (choice) => {
    const p = game.players.get(socket.data.playerId);
    if (!p || game.phase !== 'question' || game.answers.has(p.id)) return;
    const ms = Date.now() - game.startedAt;
    if (![0, 1, 2, 3].includes(choice) || ms > TIME_LIMIT_MS + 300) return;
    game.answers.set(p.id, { choice, ms });
    socket.emit('state', playerState(p));
    io.to('host').emit('answered', game.answers.size);
    const active = [...game.players.values()].filter((x) => x.connected);
    if (active.length > 0 && active.every((x) => game.answers.has(x.id))) reveal();
  });

  socket.on('disconnect', () => {
    const p = game.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
      io.to('host').emit('state', hostState());
    }
  });
});

server.listen(PORT, () => console.log(`찬송가 퀴즈 서버 실행 중: http://localhost:${PORT}  (진행 화면: /host)`));
