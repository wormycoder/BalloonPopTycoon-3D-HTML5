/* Bootstrap: input, scene assembly, main loop. */
(function (BPT) {
  'use strict';
  const C = BPT.Config, T = C.TUNING, M4 = BPT.M4;
  const { clamp, lerp, mulberry32 } = BPT;
  const A = BPT.Assets;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------- instance writer */
  function Writer(rec) { this.rec = rec; this.n = 0; }
  Writer.prototype.reset = function () { this.n = 0; return this; };
  Writer.prototype.push = function (x, y, z, s, r, g, b, em, yaw, sy, glow, sz) {
    if (this.n >= this.rec.max) return;
    const d = this.rec.data, o = this.n * 12;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = s;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = em || 0;
    d[o + 8] = yaw || 0; d[o + 9] = sy === undefined ? 1 : sy;
    d[o + 10] = glow || 0; d[o + 11] = sz === undefined ? 1 : sz;
    this.n++;
  };

  /* --------------------------------------------------------------- boot */
  const canvas = $('gl');
  let renderer;
  try {
    renderer = new BPT.Renderer(canvas);
  } catch (e) {
    console.error(e);
    $('intro').classList.add('hidden');
    $('nogl').classList.remove('hidden');
    return;
  }

  const game = new BPT.Game();
  const audio = new BPT.Audio();
  const ui = new BPT.UI(game, audio);

  const settings = {
    sense: 1, fov: 78, volume: 0.6, invert: false,
    bloom: true, grass: true, scale: 1,
  };

  const loaded = BPT.Save.load(game);
  if (loaded && loaded.settings) Object.assign(settings, loaded.settings);

  /* ----------------------------------------------------------- props */
  let props = null;
  function buildProps(arena) {
    const rnd = mulberry32(arena.id.split('').reduce((a, c) => a + c.charCodeAt(0), 7) * 977);
    const p = arena.props;
    const out = { cone: [], cyl: [], low: [], grass: [] };
    const colA = BPT.hexRgb(p.colorA), colB = BPT.hexRgb(p.colorB), trunk = BPT.hexRgb(p.trunk);
    for (let i = 0; i < p.count; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 38 + Math.pow(rnd(), 0.65) * (T.worldRadius + 90 - 38);
      const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad;
      const s = 0.7 + rnd() * 0.85;
      const t = rnd();
      const col = [lerp(colA[0], colB[0], t), lerp(colA[1], colB[1], t), lerp(colA[2], colB[2], t)];
      const yaw = rnd() * Math.PI * 2;
      if (p.kind === 'tree') {
        out.cyl.push([x, 0, z, 0.26 * s, trunk[0], trunk[1], trunk[2], 0, yaw, 6.5, 0, 1]);
        out.cone.push([x, 1.5 * s, z, 1.9 * s, col[0], col[1], col[2], 0, yaw, 2.1, 0, 1]);
        out.low.push([x, 3.9 * s, z, 1.15 * s, col[0] * 1.06, col[1] * 1.06, col[2] * 1.06, 0, yaw, 1, 0, 1]);
      } else if (p.kind === 'pine') {
        out.cyl.push([x, 0, z, 0.22 * s, trunk[0], trunk[1], trunk[2], 0, yaw, 5, 0, 1]);
        out.cone.push([x, 0.9 * s, z, 1.5 * s, col[0], col[1], col[2], 0, yaw, 4.2, 0, 1]);
      } else if (p.kind === 'palm') {
        out.cyl.push([x, 0, z, 0.2 * s, trunk[0], trunk[1], trunk[2], 0, yaw, 26, 0, 1]);
        out.low.push([x, 5.2 * s, z, 2.1 * s, col[0], col[1], col[2], 0, yaw, 0.35, 0, 1]);
      } else if (p.kind === 'pylon') {
        out.cyl.push([x, 0, z, 0.22 * s, col[0], col[1], col[2], 0.55, yaw, 34, 0.5, 1]);
        out.cone.push([x, 7.4 * s, z, 0.7 * s, col[0], col[1], col[2], 0.8, yaw, 2.4, 0.9, 1]);
      } else if (p.kind === 'cloudpuff') {
        for (let k = 0; k < 3; k++) {
          out.low.push([x + (rnd() - 0.5) * 5 * s, 0.6 + rnd() * 2.4 * s, z + (rnd() - 0.5) * 5 * s,
            (1.4 + rnd()) * s, col[0], col[1], col[2], 0.12, yaw, 0.6, 0, 1]);
        }
      }
    }
    if (p.grass) {
      const n = Math.floor(2400 * p.grass);
      for (let i = 0; i < n; i++) {
        const ang = rnd() * Math.PI * 2;
        const rad = T.plazaRadius + 1.0 + Math.pow(rnd(), 1.7) * 58;
        const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad;
        const s = 0.5 + rnd() * 0.8;
        const t = rnd();
        out.grass.push([x, 0, z, 0.34 * s, lerp(0.6, 1.0, t), lerp(0.75, 1.0, t), lerp(0.45, 0.7, t), 0,
                        rnd() * Math.PI, 1.35 / (0.34 * s) * 0.34, 0, 1]);
      }
    }
    return out;
  }

  function applyArena() {
    renderer.setArena(game.arena);
    props = buildProps(game.arena);
    game.kiosks.forEach(k => k.dirty = true);
  }
  applyArena();

  /* ------------------------------------------------------------- signs */
  function refreshSigns() {
    for (const k of game.kiosks) {
      if (!k.dirty) continue;
      k.dirty = false;
      const lv = game.lv[k.u.key];
      const c = A.signCanvas({
        title: k.u.title, desc: k.u.desc, level: lv, maxLevel: k.u.max,
        price: '$' + BPT.fmt(C.cost(k.u, lv)),
        afford: game.cash >= C.cost(k.u, lv),
        accent: k.u.accent, locked: false,
      });
      k.tex = renderer.setSign(k.u.key, c);
    }
    if (!portalTex || portalDirty) {
      portalDirty = false;
      portalTex = renderer.setSign('__portal', A.bannerCanvas(game.arena.name, 'press E to travel', game.arena.accent));
    }
  }
  let portalTex = null, portalDirty = true;

  /* ------------------------------------------------------------- input */
  const keys = Object.create(null);
  const input = { forward: 0, strafe: 0, jump: false, sprint: false, focus: false };
  let mode = 'intro';
  let touchLook = null, touchMove = null;

  function lockPointer() {
    const p = canvas.requestPointerLock && canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => canvas.requestPointerLock());
  }
  function isLocked() { return document.pointerLockElement === canvas; }

  function startGame() {
    $('intro').classList.add('hidden');
    ui.el.hud.classList.remove('hidden');
    ui.show(null);
    mode = 'playing';
    audio.ensure();
    lockPointer();
    if (loaded && loaded.offline > 1 && !welcomeShown) {
      welcomeShown = true;
      $('welcomeText').innerHTML = 'While you were away for <b>' + BPT.fmtTime(loaded.seconds) +
        '</b>, your drones and momentum earned you <b>$' + BPT.fmt(loaded.offline) + '</b>.';
      setTimeout(() => { if (mode === 'playing') { pause(); ui.show('welcome'); } }, 350);
    }
  }
  let welcomeShown = false;

  function pause() {
    if (mode === 'playing') mode = 'menu';
    if (isLocked()) document.exitPointerLock();
  }
  function resume() {
    ui.show(null);
    mode = 'playing';
    lockPointer();
  }

  $('playBtn').addEventListener('click', startGame);
  canvas.addEventListener('click', () => { if (mode === 'playing' && !isLocked()) lockPointer(); });

  let wasLocked = false;
  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) { wasLocked = true; return; }
    if (wasLocked && mode === 'playing') { wasLocked = false; mode = 'menu'; ui.show('pause'); }
  });
  document.addEventListener('pointerlockerror', () => { /* keep playing with arrow keys */ });

  document.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    const p = game.player;
    const s = 0.0022 * settings.sense;
    p.yaw += e.movementX * s;
    p.pitch += (settings.invert ? 1 : -1) * e.movementY * s;
    p.pitch = clamp(p.pitch, -1.45, 1.45);
    p.yaw = (p.yaw + Math.PI * 4) % (Math.PI * 2);
  });
  // drag-to-look fallback for contexts where pointer lock is unavailable (embeds, iframes)
  let dragging = false, dragX = 0, dragY = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isLocked()) { input.focus = true; return; }
    if (mode === 'playing') { dragging = true; dragX = e.clientX; dragY = e.clientY; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) { input.focus = false; dragging = false; } });
  window.addEventListener('mousemove', (e) => {
    if (!dragging || isLocked()) return;
    const p = game.player, s = 0.0032 * settings.sense;
    p.yaw += (e.clientX - dragX) * s;
    p.pitch = clamp(p.pitch + (settings.invert ? 1 : -1) * (e.clientY - dragY) * s, -1.45, 1.45);
    dragX = e.clientX; dragY = e.clientY;
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); togglePanel('stats'); return; }
    if (e.repeat) return;
    keys[e.code] = true;
    if (mode === 'menu') {
      if (e.code === 'Escape') { if (ui.openPanel && ui.openPanel !== 'pause') ui.show('pause'); else resume(); }
      return;
    }
    if (mode !== 'playing') return;
    if (e.code === 'KeyE') interact(e.shiftKey);
    if (e.code === 'KeyR') { pause(); ui.fillRebirth(); ui.show('rebirth'); }
    if (e.code === 'KeyM') { audio.enabled = !audio.enabled; ui.toast(audio.enabled ? 'Sound on' : 'Sound off'); }
    if (e.code === 'F11') return;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  function togglePanel(id) {
    if (mode === 'playing') { pause(); ui.fillStats(); ui.show(id); }
    else if (ui.openPanel === id) resume();
    else { if (id === 'stats') ui.fillStats(); ui.show(id); }
  }

  function interact(shift) {
    const k = game.nearestKiosk();
    if (k) {
      const before = game.lv[k.u.key];
      shift ? game.buyMax(k.u.key) : game.buy(k.u.key);
      if (game.lv[k.u.key] > before) audio.buy(); else audio.deny();
      return;
    }
    if (game.nearPortal()) {
      pause();
      ui.fillTravel((i) => {
        game.travelTo(i); applyArena(); portalDirty = true;
        audio.travel(); resume();
        ui.toast('Travelled to ' + C.ARENAS[i].name, 'x' + C.ARENAS[i].mult.toFixed(2) + ' income', 'gold');
      });
      ui.show('travel');
    }
  }

  /* ------------------------------------------------------- menu buttons */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'resume') resume();
    else if (act === 'back') ui.show('pause');
    else if (act === 'stats') { ui.fillStats(); ui.show('stats'); }
    else if (act === 'achv') { ui.fillAchievements(); ui.show('achv'); }
    else if (act === 'settings') ui.show('settings');
    else if (act === 'help') ui.show('help');
    else if (act === 'save') { $('saveText').value = BPT.Save.exportString(game); ui.show('savepanel'); }
  });
  $('rebirthGo').addEventListener('click', () => {
    const gain = game.doRebirth();
    if (gain) {
      audio.rebirth();
      ui.toast('Rebirth!', '+' + gain + ' prestige · now x' + game.prestigeMult.toFixed(2), 'gold');
      applyArena();
      resume();
    }
  });
  $('importBtn').addEventListener('click', () => {
    if (BPT.Save.importString(game, $('saveText').value)) location.reload();
    else ui.toast('Import failed', 'That save string is not valid.');
  });
  $('wipeBtn').addEventListener('click', () => {
    if (confirm('Erase your save and start over?')) { BPT.Save.wipe(); location.reload(); }
  });

  /* ---------------------------------------------------------- settings */
  function bindRange(id, outId, key, transform, after) {
    const el = $(id), out = $(outId);
    el.value = transform ? transform.to(settings[key]) : settings[key];
    out.textContent = el.value;
    el.addEventListener('input', () => {
      out.textContent = el.value;
      settings[key] = transform ? transform.from(+el.value) : +el.value;
      if (after) after();
      saveSettings();
    });
  }
  bindRange('sense', 'senseOut', 'sense');
  bindRange('fov', 'fovOut', 'fov');
  bindRange('vol', 'volOut', 'volume', { to: v => Math.round(v * 100), from: v => v / 100 },
            () => audio.setVolume(settings.volume));
  bindRange('rs', 'rsOut', 'scale', { to: v => Math.round(v * 100), from: v => v / 100 },
            () => { renderer.quality.scale = settings.scale; renderer.resize(); });
  function bindCheck(id, key, after) {
    const el = $(id);
    el.checked = !!settings[key];
    el.addEventListener('change', () => { settings[key] = el.checked; if (after) after(); saveSettings(); });
  }
  bindCheck('invert', 'invert');
  bindCheck('bloom', 'bloom', () => renderer.quality.bloom = settings.bloom ? 1 : 0);
  bindCheck('grassOn', 'grass', () => renderer.quality.grass = settings.grass ? 1 : 0);
  function saveSettings() { game.settings = settings; BPT.Save.save(game); }
  renderer.quality.bloom = settings.bloom ? 1 : 0;
  renderer.quality.grass = settings.grass ? 1 : 0;
  renderer.quality.scale = settings.scale;
  audio.setVolume(settings.volume);

  /* -------------------------------------------------------------- touch */
  if ('ontouchstart' in window) {
    const half = () => window.innerWidth / 2;
    window.addEventListener('touchstart', (e) => {
      if (mode !== 'playing') return;
      for (const t of e.changedTouches) {
        if (t.clientX < half() && !touchMove) touchMove = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
        else if (!touchLook) touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (touchMove && t.identifier === touchMove.id) {
          touchMove.dx = clamp((t.clientX - touchMove.x) / 60, -1, 1);
          touchMove.dy = clamp((t.clientY - touchMove.y) / 60, -1, 1);
        } else if (touchLook && t.identifier === touchLook.id) {
          const p = game.player, s = 0.005 * settings.sense;
          p.yaw += (t.clientX - touchLook.x) * s;
          p.pitch = clamp(p.pitch - (t.clientY - touchLook.y) * s, -1.45, 1.45);
          touchLook.x = t.clientX; touchLook.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (touchMove && t.identifier === touchMove.id) touchMove = null;
        if (touchLook && t.identifier === touchLook.id) touchLook = null;
      }
    };
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
  }

  /* ------------------------------------------------------- scene writers */
  const W = {
    balloon: new Writer(renderer.inst.balloon),
    sphere: new Writer(renderer.inst.sphere),
    low: new Writer(renderer.inst.low),
    cone: new Writer(renderer.inst.cone),
    cyl: new Writer(renderer.inst.cyl),
    box: new Writer(renderer.inst.box),
    plaza: new Writer(renderer.inst.plaza),
    ring: new Writer(renderer.inst.ring),
    decal: new Writer(renderer.inst.decal),
    bill: new Writer(renderer.inst.bill),
    grass: new Writer(renderer.inst.grass),
  };
  const signModel = M4.create();

  function drawScene(time) {
    const g = game, a = g.arena;
    const accCol = BPT.hexRgb(a.accent);
    renderer.drawGround(T.plazaRadius, BPT.hexRgb(a.ground.plaza), accCol);

    // --- static scatter
    for (const k of ['cone', 'cyl', 'low']) {
      W[k].reset();
      const arr = props[k];
      for (let i = 0; i < arr.length; i++) W[k].push.apply(W[k], arr[i]);
    }
    W.grass.reset();
    for (let i = 0; i < props.grass.length; i++) W.grass.push.apply(W.grass, props.grass[i]);

    // --- plaza + portal
    W.plaza.reset(); W.ring.reset(); W.box.reset();
    const gA = BPT.hexRgb(a.ground.plaza), acc = accCol;
    // portal pedestal in the middle of the plaza
    W.plaza.push(0, 0, 0, 2.1, gA[0] * 0.72, gA[1] * 0.72, gA[2] * 0.72, 0.02, 0, 0.5 / 2.1, 0, 1);
    W.ring.push(0, 0.52, 0, 2.25 + Math.sin(time * 1.4) * 0.04, acc[0], acc[1], acc[2], 0.6, 0, 1, 0.4, 1);
    W.ring.push(0, 0.02, 0, 3.4, acc[0], acc[1], acc[2], 0.18, 0, 1, 0.05, 1);

    // --- kiosks
    for (const k of g.kiosks) {
      const lv = g.lv[k.u.key];
      const can = lv < k.u.max && g.cash >= C.cost(k.u, lv);
      const col = BPT.hexRgb(k.u.accent);
      k.pulse = Math.max(0, k.pulse - 0.02);
      const glow = (can ? 0.32 + Math.sin(time * 3 + k.index) * 0.1 : 0.04) + k.pulse * 0.8;
      // body
      W.box.push(k.x, 0.95, k.z, 2.0, 0.30, 0.33, 0.40, 0.02, k.yaw, 0.95, 0, 0.55);
      const fx2 = Math.sin(k.yaw) * 0.57, fz2 = Math.cos(k.yaw) * 0.57;
      W.box.push(k.x + fx2, 1.0, k.z + fz2, 1.7, col[0] * 0.55, col[1] * 0.55, col[2] * 0.55, 0.06, k.yaw, 0.62, 0, 0.05);
      W.box.push(k.x, 1.86, k.z, 2.06, col[0], col[1], col[2], 0.55, k.yaw, 0.075, glow, 0.54);
      W.box.push(k.x, 0.2, k.z, 2.24, 0.13, 0.14, 0.18, 0, k.yaw, 0.17, 0, 0.62);
      // posts holding the sign
      const px = Math.cos(k.yaw) * 1.5, pz = -Math.sin(k.yaw) * 1.5;
      W.cyl.push(k.x + px, 1.9, k.z + pz, 0.1, 0.22, 0.24, 0.29, 0, 0, 13, 0, 1);
      W.cyl.push(k.x - px, 1.9, k.z - pz, 0.1, 0.22, 0.24, 0.29, 0, 0, 13, 0, 1);
    }

    // --- balloons + shadows
    W.balloon.reset(); W.decal.reset();
    for (const b of g.balloons) {
      const wide = 1 + 0.22 * b.squash, tall = 1 - 0.3 * b.squash;
      const flash = b.hitT * 0.55;
      const glow = (b.kind === 'gold' ? 0.5 + Math.sin(time * 6) * 0.2 : 0) + flash * 0.6 +
                   (b.def.iridescent ? 0.25 + Math.sin(time * 2 + b.a * 3) * 0.2 : 0);
      W.balloon.push(b.x, b.y3, b.z, b.size * wide,
        b.color[0] + flash, b.color[1] + flash, b.color[2] + flash,
        b.kind === 'gold' ? 0.35 : 0.02,
        b.a * 0.4, tall / wide, glow, 1);
      const h = clamp(1 - b.y3 / 30, 0.12, 1);
      W.decal.push(b.x, 0.035, b.z,
        b.size * (2.4 + b.y3 * 0.09), 0, 0, 0, 0, 0, 1, 0, 1);
      W.decal.rec.data[(W.decal.n - 1) * 12 + 7] = 0.42 * h;   // alpha in iColor.a
    }

    // --- drones
    W.sphere.reset();
    for (const d of g.drones) {
      W.sphere.push(d.px, d.py, d.pz, 0.17, 0.35, 0.95, 0.85, 0.6, 0, 1, 0.55, 1);
      W.sphere.push(d.px, d.py + 0.13, d.pz, 0.1, 0.1, 0.12, 0.16, 0, d.a, 0.6, 0, 1);
    }

    renderer.drawInstanced('plaza', 'plaza', W.plaza.n, 0.15);
    renderer.drawInstanced('ring', 'ring', W.ring.n, 0.2);
    renderer.drawInstanced('cyl', 'cyl', W.cyl.n, 0.15);
    renderer.drawInstanced('cone', 'cone', W.cone.n, 0.12);
    renderer.drawInstanced('lowSphere', 'low', W.low.n, 0.15);
    renderer.drawInstanced('box', 'box', W.box.n, 0.3);
    renderer.drawInstanced('sphere', 'sphere', W.sphere.n, 0.8);
    renderer.drawInstanced('balloon', 'balloon', W.balloon.n, 1.0);
    renderer.drawGrass(W.grass.n);
    renderer.drawDecals(W.decal.n);

    // --- signs
    for (const k of g.kiosks) {
      if (!k.tex) continue;
      M4.compose(signModel, k.x, 3.35, k.z, 3.9, 2.2, 1, k.yaw);
      const lv = g.lv[k.u.key];
      const can = lv < k.u.max && g.cash >= C.cost(k.u, lv);
      renderer.drawSign(signModel, k.tex, can ? 0.25 : 0);
    }
    if (portalTex) {
      const py = 3.35 + Math.sin(time * 1.1) * 0.07;
      M4.compose(signModel, 0, py, 0, 2.5, 0.78, 1, game.player.yaw);
      renderer.drawSign(signModel, portalTex, 0.3);
    }

    // --- particles
    W.bill.reset();
    for (const p of g.particles) {
      if (p.kind !== 0) continue;
      const t = 1 - p.life / p.max;
      W.bill.push(p.x, p.y, p.z, p.size, p.r, p.g, p.b2, clamp(t * 1.8, 0, 1), p.rot, 1, 0, 1);
      W.bill.rec.data[(W.bill.n - 1) * 12 + 7] = clamp(t * 1.8, 0, 1);
    }
    renderer.drawBillboards(W.bill.n, renderer.tex.confetti, false);

    W.bill.reset();
    for (const p of g.particles) {
      if (p.kind !== 1) continue;
      const t = 1 - p.life / p.max;
      W.bill.push(p.x, p.y, p.z, p.size * (1 + (1 - t) * 1.6), p.r, p.g, p.b2, t, 0, 1, 0, 1);
      W.bill.rec.data[(W.bill.n - 1) * 12 + 7] = t;
    }
    for (const r of g.rings) {
      const t = r.life / r.max;
      W.bill.push(r.x, r.y, r.z, r.size * (0.5 + t * 3.4), r.color[0], r.color[1], r.color[2], 1 - t, 0, 1, 0, 1);
      W.bill.rec.data[(W.bill.n - 1) * 12 + 7] = (1 - t) * 0.85;
    }
    // aim highlight
    if (g.aimTarget) {
      const b = g.aimTarget;
      W.bill.push(b.x, b.y3, b.z, b.size * 3.1, 1, 1, 1, 0.16, 0, 1, 0, 1);
      W.bill.rec.data[(W.bill.n - 1) * 12 + 7] = 0.16;
    }
    renderer.drawBillboards(W.bill.n, renderer.tex.dot, true);
  }

  /* --------------------------------------------------------------- loop */
  let last = performance.now(), saveTimer = 0, frames = 0, fpsT = 0, fps = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.06, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }

    renderer.resize();
    ui.resizeFx();

    if (mode === 'playing') {
      input.forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      input.strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      input.sprint = !!(keys.ShiftLeft || keys.ShiftRight);
      input.jump = !!keys.Space;
      if (touchMove) { input.forward = -touchMove.dy; input.strafe = touchMove.dx; }
      if (keys.ArrowLeft) game.player.yaw -= dt * 2.2;
      if (keys.ArrowRight) game.player.yaw += dt * 2.2;
      const ev = game.update(dt, input);
      handleEvents(ev);
      saveTimer += dt;
      if (saveTimer > 12) { saveTimer = 0; game.settings = settings; BPT.Save.save(game); }
    } else {
      game.updateParticles(dt * 0.4);
    }

    refreshSigns();
    const p = game.player;
    renderer.setCamera([p.x, p.y, p.z], p.yaw, p.pitch, settings.fov);
    renderer.flash = game.hitFlash * 0.05;
    renderer.flashColor = [1, 0.95, 0.8];
    renderer.begin(time);
    drawScene(time);
    renderer.end(0.95);

    ui.update(dt, renderer.vp, game.aimTarget);
  }

  function handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'pop': audio.pop(e.tier, false); break;
        case 'gold': ui.toast('Golden balloon!', 'Pop it before it escapes', 'gold'); audio.blip(1200, 0.3, 'sine', 0.12, 1800); break;
        case 'goldPop': audio.gold(); ui.toast('GOLD FRENZY', 'Triple income for 20s · +$' + BPT.fmt(e.cash), 'gold'); break;
        case 'goldLost': ui.toast('It got away', 'Another one along soon'); break;
        case 'boss': audio.boss(); ui.toast('A Bloatoon appears', 'Huge, slow and very rich'); break;
        case 'bossPop': audio.pop(0, true); ui.toast('Bloatoon down!', '+$' + BPT.fmt(e.cash), 'gold'); break;
        case 'achievement': audio.achieve(); ui.toast('Achievement · ' + e.a.name, e.a.desc, 'achv'); break;
        case 'buy': game.kiosks.forEach(k => { if (k.u.key === e.key) k.dirty = true; }); break;
      }
    }
    events.length = 0;
    // signs need refreshing when affordability flips
    for (const k of game.kiosks) {
      const lv = game.lv[k.u.key];
      const can = game.cash >= C.cost(k.u, lv);
      if (k.lastCan !== can) { k.lastCan = can; k.dirty = true; }
    }
  }

  window.addEventListener('beforeunload', () => { game.settings = settings; BPT.Save.save(game); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { game.settings = settings; BPT.Save.save(game); }
  });

  requestAnimationFrame(frame);
  window.BPT_DEBUG = { game, renderer, ui, settings, start: startGame,
    setMode: (m) => { mode = m; }, getMode: () => mode, fps: () => fps,
    applyArena, refreshSigns, markPortalDirty: () => { portalDirty = true; } };
})(window.BPT = window.BPT || {});
