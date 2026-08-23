/* HUD, overlay canvas (damage numbers), minimap, menus. */
(function (BPT) {
  'use strict';
  const C = BPT.Config;
  const { clamp } = BPT;

  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd'];
  function fmt(n) {
    if (!isFinite(n)) return '∞';
    if (n < 0) return '-' + fmt(-n);
    if (n < 1000) return n < 10 ? (Math.round(n * 10) / 10).toString() : Math.floor(n).toString();
    let i = 0;
    while (n >= 1000 && i < UNITS.length - 1) { n /= 1000; i++; }
    return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n)) + UNITS[i];
  }
  function fmtTime(s) {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }
  const $ = (id) => document.getElementById(id);

  class UI {
    constructor(game, audio) {
      this.g = game; this.audio = audio;
      this.el = {};
      ['hud','cash','rate','popped','arenaName','prestige','rebirths','comboWrap','comboText',
       'comboBar','bossWrap','bossBar','prompt','rebirthBar','rebirthText','upgradeStrip','map',
       'toasts','crosshair','frenzy','frenzyTime','rebirthWrap','intro','pause','settings','stats',
       'achv','help','rebirth','travel','savepanel','welcome','statsBody','tierBody','achvBody',
       'achvCount','travelBody','rebirthInfo','saveText','welcomeText','fx']
        .forEach(id => this.el[id] = $(id));
      this.mapCtx = this.el.map.getContext('2d');
      this.fxCtx = this.el.fx.getContext('2d');
      this.toastList = [];
      this.buildStrip();
    }

    /* ------------------------------------------------------------- strip */
    buildStrip() {
      this.el.upgradeStrip.innerHTML = '';
      this.stripEls = C.UPGRADES.map(u => {
        const d = document.createElement('div');
        d.className = 'up';
        d.innerHTML = '<b>' + u.title + '</b><i>0</i>';
        d.style.borderLeft = '3px solid ' + u.accent;
        this.el.upgradeStrip.appendChild(d);
        return d;
      });
    }

    /* --------------------------------------------------------------- HUD */
    update(dt, vp, aimTarget) {
      const g = this.g;
      this.el.cash.textContent = fmt(g.cash);
      this.el.rate.textContent = fmt(g.cashRate);
      this.el.popped.textContent = fmt(g.stats.popped);
      this.el.arenaName.textContent = g.arena.name;
      this.el.prestige.textContent = 'x' + g.prestigeMult.toFixed(2);
      this.el.rebirths.textContent = g.rebirths;

      // combo
      if (g.combo > 0) {
        this.el.comboWrap.classList.remove('hidden');
        this.el.comboText.textContent = 'COMBO x' + (1 + g.combo * C.TUNING.comboStep).toFixed(2);
        this.el.comboBar.style.width = clamp(g.comboTimer / C.TUNING.comboWindow, 0, 1) * 100 + '%';
      } else this.el.comboWrap.classList.add('hidden');

      // frenzy
      if (g.frenzy > 0) {
        this.el.frenzy.classList.remove('hidden');
        this.el.frenzyTime.textContent = Math.ceil(g.frenzy);
      } else this.el.frenzy.classList.add('hidden');

      // boss
      const boss = g.balloons.find(b => b.kind === 'boss');
      if (boss) {
        this.el.bossWrap.classList.remove('hidden');
        this.el.bossBar.style.width = clamp(boss.hp / boss.maxHp, 0, 1) * 100 + '%';
      } else this.el.bossWrap.classList.add('hidden');

      // rebirth bar
      const prog = clamp(g.cash / g.rebirthGoal, 0, 1);
      this.el.rebirthBar.style.width = prog * 100 + '%';
      this.el.rebirthText.textContent = g.rebirthReady
        ? 'Rebirth ready — press R'
        : 'Rebirth at $' + fmt(g.rebirthGoal);

      // upgrade strip
      C.UPGRADES.forEach((u, i) => {
        const el = this.stripEls[i], lv = g.lv[u.key];
        el.querySelector('i').textContent = lv >= u.max ? 'MAX' : lv;
        el.classList.toggle('max', lv >= u.max);
        el.classList.toggle('can', lv < u.max && g.cash >= C.cost(u, lv));
      });

      // interaction prompt
      const k = g.nearestKiosk();
      if (k) {
        const lv = g.lv[k.u.key], max = lv >= k.u.max;
        const price = C.cost(k.u, lv);
        const can = g.cash >= price;
        this.el.prompt.classList.remove('hidden');
        this.el.prompt.innerHTML = max
          ? '<b>' + k.u.title + '</b> — fully upgraded'
          : '<kbd>E</kbd> buy <b>' + k.u.title + '</b> Lv ' + (lv + 1) +
            ' — <span class="' + (can ? '' : 'no') + '">$' + fmt(price) + '</span>' +
            (can ? ' &nbsp;<kbd>Shift</kbd>+<kbd>E</kbd> max' : '');
      } else if (g.nearPortal()) {
        this.el.prompt.classList.remove('hidden');
        this.el.prompt.innerHTML = '<kbd>E</kbd> open the <b>arena portal</b>';
      } else this.el.prompt.classList.add('hidden');

      this.el.crosshair.classList.toggle('on', !!aimTarget);

      this.drawFx(vp);
      this.drawMap();
    }

    /* -------------------------------------------------- overlay canvas */
    resizeFx() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = this.el.fx;
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.fxDpr = dpr;
    }

    drawFx(vp) {
      const c = this.el.fx, ctx = this.fxCtx;
      ctx.clearRect(0, 0, c.width, c.height);
      const g = this.g;
      if (!g.numbers.length) return;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const s = this.fxDpr;
      for (const n of g.numbers) {
        const cw = vp[3] * n.x + vp[7] * n.y + vp[11] * n.z + vp[15];
        if (cw <= 0.05) continue;
        const cx = vp[0] * n.x + vp[4] * n.y + vp[8] * n.z + vp[12];
        const cy = vp[1] * n.x + vp[5] * n.y + vp[9] * n.z + vp[13];
        const x = (cx / cw * 0.5 + 0.5) * c.width;
        const y = (1 - (cy / cw * 0.5 + 0.5)) * c.height;
        const t = n.life / n.max;
        const size = (n.crit ? 26 : 18) * s * (0.75 + 0.35 * t);
        ctx.globalAlpha = clamp(t * 1.6, 0, 1);
        ctx.font = '800 ' + size.toFixed(0) + 'px ' + getComputedStyle(document.body).fontFamily;
        ctx.lineWidth = 4 * s;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        const txt = (n.crit ? '' : '') + '$' + fmt(n.value);
        const dx = x + n.ox * 34 * s, dy = y + (n.oy || 0) * 20 * s;
        ctx.strokeText(txt, dx, dy);
        ctx.fillStyle = n.crit ? '#ffe27a' : '#ffffff';
        ctx.fillText(txt, dx, dy);
      }
      ctx.globalAlpha = 1;
    }

    /* ----------------------------------------------------------- minimap */
    drawMap() {
      const g = this.g, ctx = this.mapCtx, S = this.el.map.width, R = S / 2;
      const view = 74, sc = R / view;
      const p = g.player, cy = Math.cos(-p.yaw), sy = Math.sin(-p.yaw);
      // world -> map (heading up)
      const map = (wx, wz) => {
        const dx = wx - p.x, dz = wz - p.z;
        const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy;
        return [R + rx * sc, R + rz * sc];
      };
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = 'rgba(8,16,28,0.55)'; ctx.fillRect(0, 0, S, S);

      // plaza
      const [px, pz] = map(0, 0);
      ctx.beginPath(); ctx.arc(px, pz, C.TUNING.plazaRadius * sc, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,74,0.55)'; ctx.lineWidth = 2; ctx.stroke();

      // balloons
      for (const b of g.balloons) {
        const [x, y] = map(b.x, b.z);
        ctx.beginPath();
        ctx.arc(x, y, b.kind === 'boss' ? 7 : (b.kind === 'gold' ? 5 : 3), 0, Math.PI * 2);
        ctx.fillStyle = b.kind === 'gold' ? '#ffd24a'
          : 'rgb(' + b.color.map(v => Math.round(v * 255)).join(',') + ')';
        ctx.fill();
      }
      // kiosks
      for (const k of g.kiosks) {
        const [x, y] = map(k.x, k.z);
        const lv = g.lv[k.u.key], can = lv < k.u.max && g.cash >= C.cost(k.u, lv);
        ctx.beginPath(); ctx.rect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = lv >= k.u.max ? '#9aa4ad' : (can ? '#6ee7a0' : 'rgba(255,255,255,0.55)');
        ctx.fill();
      }
      // portal
      ctx.beginPath(); ctx.arc(px, pz, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#7dd3fc'; ctx.fill();
      ctx.restore();

      // player arrow
      ctx.beginPath();
      ctx.moveTo(R, R - 9); ctx.lineTo(R + 6.5, R + 7); ctx.lineTo(R, R + 3.5); ctx.lineTo(R - 6.5, R + 7);
      ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    /* ------------------------------------------------------------ toasts */
    toast(title, sub, cls) {
      const d = document.createElement('div');
      d.className = 'toast ' + (cls || '');
      d.innerHTML = '<b>' + title + '</b>' + (sub ? '<span class="t-sub">' + sub + '</span>' : '');
      this.el.toasts.appendChild(d);
      setTimeout(() => {
        d.style.transition = 'opacity .4s, transform .4s';
        d.style.opacity = '0'; d.style.transform = 'translateX(20px)';
        setTimeout(() => d.remove(), 420);
      }, 3800);
      while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    }

    /* ------------------------------------------------------------ panels */
    show(id) {
      ['pause','settings','stats','achv','help','rebirth','travel','savepanel','welcome']
        .forEach(k => this.el[k].classList.add('hidden'));
      if (id) this.el[id].classList.remove('hidden');
      this.openPanel = id || null;
    }

    fillStats() {
      const g = this.g, s = g.stats;
      const rows = [
        ['Balloons popped', fmt(s.popped)],
        ['Total earned', '$' + fmt(s.lifetime)],
        ['Best bankroll', '$' + fmt(s.bestCash)],
        ['Current income', '$' + fmt(g.cashRate) + '/s'],
        ['Rebirths', s.popped >= 0 ? g.rebirths : 0],
        ['Prestige multiplier', 'x' + g.prestigeMult.toFixed(2)],
        ['Best combo', 'x' + (1 + s.bestCombo * C.TUNING.comboStep).toFixed(2)],
        ['Golden balloons', fmt(s.golds)],
        ['Bloatoons felled', fmt(s.bosses)],
        ['Shots landed', fmt(s.hits)],
        ['Critical hits', fmt(s.crits)],
        ['Distance walked', (s.distance / 1000).toFixed(2) + ' km'],
        ['Time played', fmtTime(s.playtime)],
        ['Damage per second', fmt(g.dps)],
      ];
      this.el.statsBody.innerHTML = rows.map(r =>
        '<div class="stat"><b>' + r[1] + '</b><span>' + r[0] + '</span></div>').join('');
      this.el.tierBody.innerHTML = C.BALLOONS.map((b, i) =>
        '<div class="tier"><i style="background:' + b.color + '"></i><b>' +
        fmt(s.tierPops[i] || 0) + '</b>' + b.name + '</div>').join('');
    }

    fillAchievements() {
      const g = this.g;
      const got = C.ACHIEVEMENTS.filter(a => g.achieved[a.id]).length;
      this.el.achvCount.textContent = got + ' / ' + C.ACHIEVEMENTS.length;
      this.el.achvBody.innerHTML = C.ACHIEVEMENTS.map(a =>
        '<div class="ach ' + (g.achieved[a.id] ? 'got' : '') + '"><b>' + a.name +
        '</b><span>' + a.desc + '</span></div>').join('');
    }

    fillTravel(onPick) {
      const g = this.g;
      this.el.travelBody.innerHTML = C.ARENAS.map((a, i) => {
        const locked = a.unlock > g.rebirths;
        return '<div class="arena ' + (locked ? 'locked' : '') + (i === g.arenaIndex ? ' here' : '') +
          '" data-i="' + i + '"><b style="color:' + a.accent + '">' + a.name + '</b><span>' + a.sub +
          '</span><em>' + (locked ? 'Unlocks at ' + a.unlock + ' rebirths' : 'x' + a.mult.toFixed(2) + ' income') +
          '</em></div>';
      }).join('');
      Array.from(this.el.travelBody.children).forEach(el => {
        el.onclick = () => {
          const i = +el.dataset.i;
          if (C.ARENAS[i].unlock > g.rebirths) return;
          onPick(i);
        };
      });
    }

    fillRebirth() {
      const g = this.g;
      const gain = g.prestigeGain();
      this.el.rebirthInfo.innerHTML = g.rebirthReady
        ? 'Rebirthing resets your cash and every upgrade, but grants <b>' + gain +
          ' prestige point' + (gain === 1 ? '' : 's') + '</b> — permanently multiplying all income.<br><br>' +
          'You would go from <b>x' + g.prestigeMult.toFixed(2) + '</b> to <b>x' +
          (1 + 0.25 * (g.prestige + gain)).toFixed(2) + '</b>, and the next arena unlocks at ' +
          (C.ARENAS.find(a => a.unlock > g.rebirths) ?
            (C.ARENAS.find(a => a.unlock > g.rebirths).unlock + ' rebirths.') : 'nothing left to unlock.')
        : 'You need <b>$' + fmt(g.rebirthGoal) + '</b> to rebirth. You have <b>$' + fmt(g.cash) + '</b>.';
      $('rebirthGo').disabled = !g.rebirthReady;
      $('rebirthGo').style.opacity = g.rebirthReady ? 1 : 0.45;
    }
  }

  BPT.UI = UI; BPT.fmt = fmt; BPT.fmtTime = fmtTime;
})(window.BPT = window.BPT || {});
