// 첫 소절 재생기: 음원 파일(audio)이 있으면 그 구간을, 없으면 멜로디(notes)를 합성해서 들려줍니다.
const Player = (() => {
  let ctx = null;
  let nodes = [];
  let audioEl = null;
  let stopTimer = null;
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function freq(name) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(name);
    if (!m) return 0;
    const semi = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (semi - 9) / 12 + (Number(m[3]) - 4));
  }

  function unlock() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function stop() {
    nodes.forEach((n) => { try { n.stop(); } catch (e) {} });
    nodes = [];
    clearTimeout(stopTimer);
    if (audioEl) { audioEl.pause(); audioEl = null; }
  }

  function playNotes(notes, bpm) {
    unlock();
    const beat = 60 / (bpm || 100);
    let t = ctx.currentTime + 0.15;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    for (const tok of notes.trim().split(/\s+/)) {
      const [name, len] = tok.split(':');
      const dur = (parseFloat(len) || 1) * beat;
      const f = freq(name);
      if (f) {
        // 피아노 비슷한 소리: 기본음 + 배음 2개, 빠르게 올라갔다 천천히 사라지는 음량
        [[1, 'triangle', 0.6], [2, 'sine', 0.22], [3, 'sine', 0.08]].forEach(([mul, type, vol]) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = type;
          o.frequency.value = f * mul;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.02);
          g.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur * 0.9);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
          o.connect(g).connect(master);
          o.start(t);
          o.stop(t + dur + 0.3);
          nodes.push(o);
        });
      }
      t += dur;
    }
  }

  function play(a) {
    stop();
    if (!a) return;
    if (a.audio) {
      const start = a.start || 0;
      audioEl = new Audio(a.audio);
      audioEl.currentTime = start;
      const el = audioEl;
      el.play().catch(() => { if (a.notes) playNotes(a.notes, a.bpm); });
      stopTimer = setTimeout(() => el.pause(), (a.duration || 10) * 1000);
      el.addEventListener('error', () => { if (a.notes && audioEl === el) playNotes(a.notes, a.bpm); });
    } else if (a.notes) {
      playNotes(a.notes, a.bpm);
    }
  }

  return { play, stop, unlock };
})();
