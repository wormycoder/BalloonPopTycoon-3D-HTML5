/* localStorage persistence + offline earnings. */
(function (BPT) {
  'use strict';
  const KEY = 'balloonPopTycoon3D.v1';
  const T = BPT.Config.TUNING;

  function serialize(g) {
    return {
      v: 1,
      cash: g.cash, runEarned: g.runEarned, lv: g.lv,
      rebirths: g.rebirths, prestige: g.prestige, arenaIndex: g.arenaIndex,
      stats: g.stats, achieved: g.achieved,
      cashRate: g.cashRate,
      saved: Date.now(),
      settings: g.settings || null,
    };
  }

  function save(g) {
    try {
      g.lastSave = Date.now();
      localStorage.setItem(KEY, JSON.stringify(serialize(g)));
      return true;
    } catch (e) { return false; }
  }

  function load(g) {
    let raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return null; }
    if (!d || d.v !== 1) return null;
    g.cash = +d.cash || 0;
    g.runEarned = +d.runEarned || 0;
    Object.keys(g.lv).forEach(k => { g.lv[k] = (d.lv && +d.lv[k]) || 0; });
    g.rebirths = +d.rebirths || 0;
    g.prestige = +d.prestige || 0;
    g.arenaIndex = Math.min(+d.arenaIndex || 0, BPT.Config.ARENAS.length - 1);
    if (BPT.Config.ARENAS[g.arenaIndex].unlock > g.rebirths) g.arenaIndex = 0;
    if (d.stats) {
      Object.assign(g.stats, d.stats);
      if (!Array.isArray(g.stats.tierPops)) g.stats.tierPops = new Array(BPT.Config.BALLOONS.length).fill(0);
    }
    g.achieved = d.achieved || {};
    g.cashRate = +d.cashRate || 0;
    g.syncDrones();
    g.kiosks.forEach(k => k.dirty = true);

    // offline earnings
    let offline = 0, seconds = 0;
    if (d.saved) {
      seconds = Math.max(0, (Date.now() - d.saved) / 1000);
      seconds = Math.min(seconds, T.offlineCapHours * 3600);
      offline = g.cashRate * seconds * T.offlineRate;
      if (offline > 1) { g.cash += offline; g.stats.lifetime += offline; g.runEarned += offline; }
      else offline = 0;
    }
    return { offline, seconds, settings: d.settings };
  }

  function wipe() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function exportString(g) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(serialize(g))))); }
    catch (e) { return ''; }
  }
  function importString(g, str) {
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }

  BPT.Save = { save, load, wipe, exportString, importString, KEY };
})(window.BPT = window.BPT || {});
