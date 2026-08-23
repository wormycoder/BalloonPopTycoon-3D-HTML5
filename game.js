/* Simulation: player, balloons, shooting, economy, upgrades, events. */
(function (BPT) {
  'use strict';
  const C = BPT.Config, T = C.TUNING, E = C.EFFECT;
  const { clamp, lerp, mulberry32 } = BPT;

  const TAU = Math.PI * 2;
  const rnd = Math.random;
  function rr(a, b) { return a + Math.random() * (b - a); }

  function hexRgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  class Game {
    constructor() {
      this.kiosks = C.UPGRADES.map((u, i) => {
        const th = (i + 0.5) * (TAU / C.UPGRADES.length);
        return {
          u, index: i,
          x: Math.sin(th) * T.kioskRadius, z: Math.cos(th) * T.kioskRadius,
          yaw: th + Math.PI, dirty: true, pulse: 0,
        };
      });
      this.reset(true);
    }

    /* ------------------------------------------------------------- state */
    reset(hard) {
      const p = this.player = this.player || {};
      p.x = 0; p.y = T.eyeHeight; p.z = 28; p.vy = 0; p.yaw = 0; p.pitch = -0.05; p.onGround = true;
      this.balloons = [];
      this.particles = [];
      this.rings = [];
      this.numbers = [];
      this.drones = [];
      this.spawnTimer = 0;
      this.fireTimer = 0;
      this.combo = 0; this.comboTimer = 0;
      this.frenzy = 0;
      this.goldTimer = rr(T.goldEvery[0], T.goldEvery[1]);
      this.popsSinceBoss = 0;
      this.bossAlive = false;
      this.cashRate = 0; this.cashAccum = 0; this.rateTimer = 0;
      this.aimTarget = null;
      this.hitFlash = 0;
      this.events = [];               // {type, ...} consumed by main/ui
      if (hard) {
        this.cash = 0;
        this.runEarned = 0;
        this.lv = {}; C.UPGRADES.forEach(u => this.lv[u.key] = 0);
        this.rebirths = 0;
        this.prestige = 0;
        this.arenaIndex = 0;
        this.stats = {
          popped: 0, lifetime: 0, bestCombo: 0, golds: 0, bosses: 0,
          distance: 0, playtime: 0, tierPops: new Array(C.BALLOONS.length).fill(0),
          hits: 0, crits: 0, bestCash: 0,
        };
        this.achieved = {};
        this.lastSave = Date.now();
      }
      this.kiosks.forEach(k => k.dirty = true);
      this.syncDrones();
    }

    softReset() {            // rebirth: keep prestige + stats
      const keep = {
        rebirths: this.rebirths, prestige: this.prestige, stats: this.stats,
        achieved: this.achieved, arenaIndex: this.arenaIndex, lastSave: this.lastSave,
      };
      this.reset(true);
      Object.assign(this, keep);
      this.kiosks.forEach(k => k.dirty = true);
      this.syncDrones();
    }

    /* --------------------------------------------------------- derived */
    get arena() { return C.ARENAS[this.arenaIndex]; }
    get prestigeMult() { return 1 + 0.25 * this.prestige; }
    get incomeMult() {
      return E.cashMult(this.lv.cash) * this.prestigeMult * this.arena.mult *
             (1 + this.combo * T.comboStep) * (this.frenzy > 0 ? T.goldFrenzyMult : 1);
    }
    get damage() { return E.damage(this.lv.damage) * (1 + 0.1 * this.prestige); }
    get fireRate() { return E.fireRate(this.lv.fire); }
    get range() { return E.range(this.lv.range); }
    get dps() { return this.damage * this.fireRate * (1 + 0.6 * E.droneCount(this.lv.drone)); }
    get comboMax() { return T.comboMax + Math.floor(this.rebirths / 2); }
    get rebirthGoal() { return Math.floor(T.rebirthBase * Math.pow(T.rebirthGrow, this.rebirths)); }
    get rebirthReady() { return this.cash >= this.rebirthGoal; }
    upgradeCost(key) {
      const u = C.UPGRADES.find(x => x.key === key);
      return C.cost(u, this.lv[key]);
    }
    unlockedArenas() { return C.ARENAS.filter(a => a.unlock <= this.rebirths); }

    /* ------------------------------------------------------------ input */
    buy(key, count) {
      const u = C.UPGRADES.find(x => x.key === key);
      let bought = 0;
      count = count || 1;
      while (bought < count && this.lv[key] < u.max) {
        const c = C.cost(u, this.lv[key]);
        if (this.cash < c) break;
        this.cash -= c; this.lv[key]++; bought++;
      }
      if (bought) {
        this.kiosks.forEach(k => { if (k.u.key === key) { k.dirty = true; k.pulse = 1; } });
        if (key === 'drone') this.syncDrones();
        this.events.push({ type: 'buy', key, count: bought });
      } else {
        this.events.push({ type: 'deny', key });
      }
      return bought;
    }
    buyMax(key) { return this.buy(key, 999); }

    prestigeGain() {
      const ratio = Math.max(1, this.runEarned / T.rebirthBase);
      return 1 + Math.floor(Math.log(ratio) / Math.log(6));
    }

    doRebirth() {
      if (!this.rebirthReady) return false;
      const gain = this.prestigeGain();
      this.prestige += gain;
      this.rebirths++;
      const before = this.arenaIndex;
      this.softReset();
      this.arenaIndex = before;
      this.events.push({ type: 'rebirth', gain });
      return gain;
    }

    travelTo(i) {
      if (C.ARENAS[i].unlock > this.rebirths) return false;
      this.arenaIndex = i;
      this.balloons.length = 0;
      this.bossAlive = false;
      this.popsSinceBoss = Math.min(this.popsSinceBoss, C.TUNING.bossEvery - 40);
      this.events.push({ type: 'travel', index: i });
      return true;
    }

    syncDrones() {
      const want = E.droneCount(this.lv.drone);
      while (this.drones.length < want) {
        this.drones.push({ a: rr(0, TAU), r: 2.2 + this.drones.length * 0.35, y: 0, t: 0, target: null, cd: 0 });
      }
      this.drones.length = want;
    }

    /* --------------------------------------------------------- balloons */
    tierWeights() {
      // difficulty follows raw firepower, not the number of upgrades bought
      const power = Math.log(Math.max(1, this.dps)) / Math.log(3.1);
      const center = clamp(power - 0.6 + this.rebirths * 0.35, 0, C.BALLOONS.length - 1);
      const w = [];
      for (let i = 0; i < C.BALLOONS.length; i++) {
        const d = i - center;
        w.push(Math.exp(-(d * d) / 3.0) * (i <= center + 1.6 ? 1 : 0.12));
      }
      return w;
    }

    pickTier() {
      const w = this.tierWeights();
      let tot = 0; for (const v of w) tot += v;
      let r = Math.random() * tot;
      for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
      return 0;
    }

    spawnBalloon(kind) {
      const tierIdx = kind === 'gold' || kind === 'boss' ? 0 : this.pickTier();
      let def, hp, pay;
      if (kind === 'gold') {
        def = C.GOLD; hp = Math.max(30, this.dps * 1.5); pay = 0;
      } else if (kind === 'boss') {
        def = C.BOSS; hp = Math.max(600, this.dps * 22); pay = Math.max(2500, this.cashRate * 90);
      } else {
        def = C.BALLOONS[tierIdx];
        hp = def.hp * (1 + this.rebirths * 0.25);
        pay = def.pay;
      }
      const b = {
        kind: kind || 'normal', tier: tierIdx, def,
        a: rr(0, TAU),
        r: kind === 'boss' ? rr(13, 19) : rr(T.orbitInner, T.orbitOuter),
        y: kind === 'boss' ? rr(5, 9) : rr(T.orbitLow, T.orbitHigh),
        spd: def.speed * rr(0.8, 1.2) * (Math.random() < 0.5 ? -1 : 1) * 0.22,
        bob: rr(0, TAU), bobAmp: rr(0.25, 0.9), bobRate: rr(0.5, 1.1),
        size: def.scale * 0.55,
        hp, maxHp: hp, pay,
        squash: 0, hitT: 0, rise: kind === 'gold' ? 0.55 : 0, life: 0,
        color: hexRgb(def.color),
        x: 0, y3: 0, z: 0,
      };
      b.x = Math.sin(b.a) * b.r; b.z = Math.cos(b.a) * b.r;
      this.balloons.push(b);
      if (kind === 'boss') { this.bossAlive = true; this.events.push({ type: 'boss' }); }
      if (kind === 'gold') this.events.push({ type: 'gold' });
      return b;
    }

    /* ------------------------------------------------------------ update */
    update(dt, input) {
      dt = Math.min(dt, 0.05);
      this.stats.playtime += dt;
      this.updatePlayer(dt, input);
      this.updateSpawns(dt);
      this.updateBalloons(dt);
      this.updateShooting(dt, input);
      this.updateDrones(dt);
      this.updateParticles(dt);
      this.updateEconomy(dt);
      this.checkAchievements();
      return this.events;
    }

    updatePlayer(dt, input) {
      const p = this.player;
      const speed = input.sprint ? T.sprintSpeed : T.walkSpeed;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      // forward = (sin yaw, 0, -cos yaw), right = (cos yaw, 0, sin yaw)
      let dx = (sy * input.forward + cy * input.strafe);
      let dz = (-cy * input.forward + sy * input.strafe);
      const l = Math.hypot(dx, dz);
      if (l > 1) { dx /= l; dz /= l; }
      const nx = p.x + dx * speed * dt, nz = p.z + dz * speed * dt;
      this.stats.distance += Math.hypot(nx - p.x, nz - p.z);
      p.x = nx; p.z = nz;

      // keep inside the world, and don't walk through kiosks
      const d = Math.hypot(p.x, p.z);
      if (d > T.worldRadius) { p.x = p.x / d * T.worldRadius; p.z = p.z / d * T.worldRadius; }
      for (const k of this.kiosks) {
        const ddx = p.x - k.x, ddz = p.z - k.z, dd = Math.hypot(ddx, ddz);
        if (dd < 1.5 && dd > 0.0001) { p.x = k.x + ddx / dd * 1.5; p.z = k.z + ddz / dd * 1.5; }
      }
      const pd = Math.hypot(p.x, p.z);
      if (pd < 2.2 && pd > 0.0001) { p.x = p.x / pd * 2.2; p.z = p.z / pd * 2.2; }

      // ground height: the plaza is a low platform
      const groundY = 0;
      if (input.jump && p.onGround) { p.vy = T.jumpSpeed; p.onGround = false; }
      p.vy -= T.gravity * dt;
      p.y += p.vy * dt;
      const floor = groundY + T.eyeHeight;
      if (p.y <= floor) { p.y = floor; p.vy = 0; p.onGround = true; }
    }

    updateSpawns(dt) {
      const maxB = E.maxBalloons(this.lv.limit);
      this.spawnTimer -= dt;
      const interval = E.spawnInterval(this.lv.rate);
      while (this.spawnTimer <= 0) {
        this.spawnTimer += interval;
        if (this.balloons.length < maxB) this.spawnBalloon('normal');
      }
      this.goldTimer -= dt;
      if (this.goldTimer <= 0) {
        this.goldTimer = rr(T.goldEvery[0], T.goldEvery[1]);
        if (this.stats.popped > 20) this.spawnBalloon('gold');
      }
      if (!this.bossAlive && this.popsSinceBoss >= T.bossEvery) {
        this.popsSinceBoss = 0;
        this.spawnBalloon('boss');
      }
      if (this.frenzy > 0) this.frenzy = Math.max(0, this.frenzy - dt);
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
    }

    updateBalloons(dt) {
      const list = this.balloons;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.life += dt;
        b.a += b.spd * dt;
        b.bob += b.bobRate * dt;
        b.x = Math.sin(b.a) * b.r;
        b.z = Math.cos(b.a) * b.r;
        b.y += b.rise * dt;
        b.y3 = b.y + Math.sin(b.bob) * b.bobAmp;
        b.squash *= Math.max(0, 1 - dt * 7);
        b.hitT = Math.max(0, b.hitT - dt * 3.4);
        if (b.kind === 'gold' && (b.y > 46 || b.life > 26)) {
          list.splice(i, 1);
          this.events.push({ type: 'goldLost' });
        }
      }
    }

    /** Ray/sphere pick along the view direction. */
    pick(origin, dir, maxDist) {
      let best = null, bestT = maxDist;
      for (const b of this.balloons) {
        const ox = b.x - origin[0], oy = b.y3 - origin[1], oz = b.z - origin[2];
        const t = ox * dir[0] + oy * dir[1] + oz * dir[2];
        if (t < 0.2 || t > bestT) continue;
        const px = ox - dir[0] * t, py = oy - dir[1] * t, pz = oz - dir[2] * t;
        const rad = b.size * T.aimAssist;
        if (px * px + py * py + pz * pz <= rad * rad) { best = b; bestT = t; }
      }
      return best;
    }

    updateShooting(dt, input) {
      const p = this.player;
      const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
      const dir = [cp * Math.sin(p.yaw), sp, -cp * Math.cos(p.yaw)];
      const origin = [p.x, p.y, p.z];
      this.aimTarget = this.pick(origin, dir, this.range);

      const rate = this.fireRate * (input.focus ? 2 : 1);
      this.fireTimer += dt * rate;
      let shots = Math.floor(this.fireTimer);
      this.fireTimer -= shots;
      if (shots > 6) shots = 6;
      if (!this.aimTarget) { this.fireTimer = Math.min(this.fireTimer, 0.9); return; }
      for (let s = 0; s < shots; s++) {
        if (!this.aimTarget || this.aimTarget.hp <= 0) break;
        this.hit(this.aimTarget, this.damage, origin);
      }
    }

    updateDrones(dt) {
      for (const d of this.drones) {
        d.t += dt;
        d.a += dt * 1.15;
        d.cd -= dt;
        const p = this.player;
        d.px = p.x + Math.sin(d.a) * d.r;
        d.pz = p.z + Math.cos(d.a) * d.r;
        d.py = p.y + 0.55 + Math.sin(d.t * 2.2 + d.r) * 0.14;
        if (d.cd <= 0) {
          d.cd = 0.42;
          // nearest balloon within range
          let best = null, bd = this.range * 0.9;
          for (const b of this.balloons) {
            const dd = Math.hypot(b.x - d.px, b.y3 - d.py, b.z - d.pz);
            if (dd < bd) { bd = dd; best = b; }
          }
          if (best) {
            d.target = best;
            this.hit(best, this.damage * 0.55, [d.px, d.py, d.pz], true);
          } else d.target = null;
        }
      }
    }

    hit(b, dmg, from, silent) {
      const crit = Math.random() < E.critChance(this.lv.crit);
      if (crit) dmg *= T.critMult;
      const applied = Math.min(dmg, b.hp);
      b.hp -= applied;
      b.squash = Math.min(1, b.squash + 0.55);
      b.hitT = 1;
      this.stats.hits++;
      if (crit) this.stats.crits++;

      if (b.kind !== 'gold') {
        const share = applied / b.maxHp;
        const gain = b.pay * share * this.incomeMult;
        this.addCash(gain);
        if (this.numbers.length < 26 && (crit || this.numbers.length < 14)) {
          this.numbers.push({
            x: b.x, y: b.y3 + b.size * 0.8, z: b.z, life: 0.85, max: 0.85,
            value: gain, crit, vy: 1.5 + Math.random() * 0.9,
            ox: (Math.random() - 0.5) * 2.4, oy: (Math.random() - 0.5) * 1.2,
          });
        }
      }
      this.spark(b, from, crit);
      if (b.hp <= 0) this.pop(b);
      if (!silent) this.hitFlash = Math.min(1, this.hitFlash + 0.35);
    }

    addCash(v) {
      if (!isFinite(v) || v <= 0) return;
      this.cash += v; this.runEarned += v; this.stats.lifetime += v;
      this.cashAccum += v;
      if (this.cash > this.stats.bestCash) this.stats.bestCash = this.cash;
    }

    pop(b) {
      const i = this.balloons.indexOf(b);
      if (i >= 0) this.balloons.splice(i, 1);
      this.stats.popped++;
      this.popsSinceBoss++;
      if (b.kind === 'normal') this.stats.tierPops[b.tier]++;

      this.combo = Math.min(this.comboMax, this.combo + 1);
      this.comboTimer = T.comboWindow + this.lv.crit * 0.02;
      if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;

      const bonus = b.pay * 0.3 * this.incomeMult;
      if (b.kind !== 'gold') this.addCash(bonus);

      this.burst(b);
      this.rings.push({ x: b.x, y: b.y3, z: b.z, life: 0, max: 0.5, size: b.size * 2.2,
                        color: b.color.slice() });

      if (b.kind === 'gold') {
        this.stats.golds++;
        this.frenzy = T.goldFrenzy;
        const bonusCash = Math.max(250, this.cashRate * 45);
        this.addCash(bonusCash);
        this.events.push({ type: 'goldPop', cash: bonusCash });
      } else if (b.kind === 'boss') {
        this.stats.bosses++;
        this.bossAlive = false;
        this.addCash(b.pay);
        this.events.push({ type: 'bossPop', cash: b.pay });
      } else {
        this.events.push({ type: 'pop', tier: b.tier });
      }
    }

    /* ------------------------------------------------------- particles */
    spark(b, from, crit) {
      const n = crit ? 5 : 2;
      for (let i = 0; i < n; i++) {
        if (this.particles.length > 700) break;
        this.particles.push({
          x: b.x + rr(-0.3, 0.3) * b.size, y: b.y3 + rr(-0.3, 0.3) * b.size, z: b.z + rr(-0.3, 0.3) * b.size,
          vx: rr(-2, 2), vy: rr(0.4, 3), vz: rr(-2, 2),
          size: rr(0.09, 0.2) * (crit ? 1.8 : 1), life: 0, max: rr(0.18, 0.4),
          r: crit ? 1 : b.color[0] * 1.4, g: crit ? 0.85 : b.color[1] * 1.4, b2: crit ? 0.3 : b.color[2] * 1.4,
          kind: 1, rot: 0, vrot: 0, grav: 4,
        });
      }
    }

    burst(b) {
      const count = b.kind === 'boss' ? 90 : (b.kind === 'gold' ? 60 : 16 + Math.min(20, b.tier * 3));
      for (let i = 0; i < count; i++) {
        if (this.particles.length > 900) break;
        const sp = b.kind === 'boss' ? rr(4, 16) : rr(2.5, 9);
        const th = rr(0, TAU), ph = Math.acos(rr(-1, 1));
        this.particles.push({
          x: b.x, y: b.y3, z: b.z,
          vx: Math.sin(ph) * Math.cos(th) * sp,
          vy: Math.cos(ph) * sp * 0.75 + 2.5,
          vz: Math.sin(ph) * Math.sin(th) * sp,
          size: rr(0.1, 0.26) * (b.kind === 'boss' ? 2.4 : b.def.scale),
          life: 0, max: rr(0.7, 1.7),
          r: b.color[0], g: b.color[1], b2: b.color[2],
          kind: 0, rot: rr(0, TAU), vrot: rr(-9, 9), grav: 11,
        });
      }
    }

    updateParticles(dt) {
      const P = this.particles;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life += dt;
        if (p.life >= p.max) { P.splice(i, 1); continue; }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += p.vrot * dt;
        const drag = Math.max(0, 1 - dt * (p.kind === 1 ? 5 : 1.4));
        p.vx *= drag; p.vz *= drag;
        if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life += dt;
        if (r.life >= r.max) this.rings.splice(i, 1);
      }
      for (let i = this.numbers.length - 1; i >= 0; i--) {
        const n = this.numbers[i];
        n.life -= dt;
        n.y += n.vy * dt; n.vy *= Math.max(0, 1 - dt * 1.6);
        if (n.life <= 0) this.numbers.splice(i, 1);
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    }

    updateEconomy(dt) {
      this.rateTimer += dt;
      if (this.rateTimer >= 0.35) {
        const inst = this.cashAccum / this.rateTimer;
        this.cashRate = this.cashRate * 0.7 + inst * 0.3;
        this.cashAccum = 0; this.rateTimer = 0;
      }
    }

    /* ---------------------------------------------------- achievements */
    checkAchievements() {
      const s = this.stats;
      const anyMaxed = C.UPGRADES.some(u => this.lv[u.key] >= u.max);
      const allMaxed = C.UPGRADES.every(u => this.lv[u.key] >= u.max);
      const ctx = {
        popped: s.popped, lifetime: s.lifetime, bestCombo: s.bestCombo, golds: s.golds,
        bosses: s.bosses, rebirths: this.rebirths, anyMaxed, allMaxed, lv: this.lv,
        tierPops: s.tierPops, distance: s.distance,
      };
      for (const a of C.ACHIEVEMENTS) {
        if (this.achieved[a.id]) continue;
        let ok = false;
        try { ok = a.test(ctx); } catch (e) { ok = false; }
        if (ok) {
          this.achieved[a.id] = Date.now();
          this.events.push({ type: 'achievement', a });
        }
      }
    }

    nearestKiosk() {
      const p = this.player;
      let best = null, bd = 5.0;
      for (const k of this.kiosks) {
        const d = Math.hypot(p.x - k.x, p.z - k.z);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    nearPortal() { return Math.hypot(this.player.x, this.player.z) < 4.6; }
  }

  BPT.Game = Game;
  BPT.hexRgb = hexRgb;
})(window.BPT = window.BPT || {});
