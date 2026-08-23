/* Procedural geometry + textures. Everything is generated at runtime, so the
   game ships with zero binary assets. */
(function (BPT) {
  'use strict';
  const { clamp, lerp, smoothstep, mulberry32 } = BPT;

  /* ---------------------------------------------------------------- geometry */

  function emptyMesh() { return { position: [], normal: [], uv: [], index: [] }; }

  /** Surface of revolution. profile = [[radius, y], ...] top -> bottom. */
  function lathe(profile, segments, vScale) {
    const m = emptyMesh();
    const rows = profile.length;
    for (let i = 0; i < rows; i++) {
      const [r, y] = profile[i];
      // tangent along the profile for normals
      const p0 = profile[Math.max(0, i - 1)], p1 = profile[Math.min(rows - 1, i + 1)];
      let tr = p1[0] - p0[0], ty = p1[1] - p0[1];
      let nr = ty, ny = -tr;
      const nl = Math.hypot(nr, ny) || 1; nr /= nl; ny /= nl;
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        m.position.push(r * ca, y * (vScale || 1), r * sa);
        m.normal.push(nr * ca, ny, nr * sa);
        m.uv.push(s / segments, 1 - i / (rows - 1));
      }
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let s = 0; s < segments; s++) {
        const a = i * (segments + 1) + s, b = a + segments + 1;
        m.index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return m;
  }

  function sphere(segments, rings, squashY) {
    const profile = [];
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * Math.PI;
      profile.push([Math.sin(phi), Math.cos(phi)]);
    }
    return lathe(profile, segments, squashY || 1);
  }

  const BALLOON_PROFILE = [
    [0.00, 1.16], [0.30, 1.12], [0.55, 1.02], [0.76, 0.86], [0.91, 0.63],
    [0.99, 0.34], [1.00, 0.02], [0.95, -0.29], [0.83, -0.57], [0.64, -0.81],
    [0.42, -0.99], [0.22, -1.10], [0.11, -1.17], [0.14, -1.25], [0.10, -1.33],
    [0.00, -1.37],
  ];
  function balloon(segments, rings) {
    // resample the profile for a smoother surface
    const src = BALLOON_PROFILE, out = [];
    const n = rings || 26;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * (src.length - 1);
      const i0 = Math.floor(t), i1 = Math.min(src.length - 1, i0 + 1), f = t - i0;
      out.push([lerp(src[i0][0], src[i1][0], f), lerp(src[i0][1], src[i1][1], f)]);
    }
    return lathe(out, segments || 22);
  }

  function cone(radius, height, segments) {
    return lathe([[0, height], [radius * 0.55, height * 0.45], [radius, 0], [0, 0]], segments);
  }
  function cylinder(radius, height, segments, taper) {
    return lathe([[0, height], [radius * (taper || 1), height], [radius, 0], [0, 0]], segments);
  }
  function disc(radius, segments) {
    return lathe([[0, 0], [radius, 0]], segments);
  }

  function box(w, h, d) {
    const m = emptyMesh();
    const x = w / 2, y = h / 2, z = d / 2;
    const faces = [
      [[-x,-y, z],[ x,-y, z],[ x, y, z],[-x, y, z], [0,0,1]],
      [[ x,-y,-z],[-x,-y,-z],[-x, y,-z],[ x, y,-z], [0,0,-1]],
      [[-x,-y,-z],[-x,-y, z],[-x, y, z],[-x, y,-z], [-1,0,0]],
      [[ x,-y, z],[ x,-y,-z],[ x, y,-z],[ x, y, z], [1,0,0]],
      [[-x, y, z],[ x, y, z],[ x, y,-z],[-x, y,-z], [0,1,0]],
      [[-x,-y,-z],[ x,-y,-z],[ x,-y, z],[-x,-y, z], [0,-1,0]],
    ];
    faces.forEach((f, fi) => {
      const base = fi * 4;
      const uvs = [[0,0],[1,0],[1,1],[0,1]];
      for (let i = 0; i < 4; i++) {
        m.position.push(f[i][0], f[i][1], f[i][2]);
        m.normal.push(f[4][0], f[4][1], f[4][2]);
        m.uv.push(uvs[i][0], uvs[i][1]);
      }
      m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return m;
  }

  /** XY quad centred on the origin, facing +Z. Used for billboards & signs. */
  function quad(w, h) {
    const x = (w || 1) / 2, y = (h || 1) / 2;
    return {
      position: [-x,-y,0,  x,-y,0,  x,y,0,  -x,y,0],
      normal:   [0,0,1, 0,0,1, 0,0,1, 0,0,1],
      uv:       [0,0, 1,0, 1,1, 0,1],
      index:    [0,1,2, 0,2,3],
    };
  }

  /** Two crossed quads standing on the ground - grass tufts. */
  function crossedQuads(w, h) {
    const m = emptyMesh();
    const add = (dx, dz) => {
      const base = m.position.length / 3;
      const x = w / 2;
      m.position.push(-x*dx, 0, -x*dz,  x*dx, 0, x*dz,  x*dx, h, x*dz,  -x*dx, h, -x*dz);
      for (let i = 0; i < 4; i++) m.normal.push(0, 1, 0);
      m.uv.push(0,0, 1,0, 1,1, 0,1);
      m.index.push(base, base+1, base+2, base, base+2, base+3);
    };
    add(1, 0); add(0, 1); add(0.7, 0.7);
    return m;
  }

  /** Big ground plane, subdivided so vertex fog/undulation reads well. */
  function plane(size, sub) {
    const m = emptyMesh();
    for (let j = 0; j <= sub; j++) {
      for (let i = 0; i <= sub; i++) {
        const u = i / sub, v = j / sub;
        m.position.push((u - 0.5) * size, 0, (v - 0.5) * size);
        m.normal.push(0, 1, 0);
        m.uv.push(u * size / 8, v * size / 8);
      }
    }
    for (let j = 0; j < sub; j++) {
      for (let i = 0; i < sub; i++) {
        const a = j * (sub + 1) + i, b = a + sub + 1;
        m.index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    return m;
  }

  /** Flat annulus on the ground (arena ring, platform rims). */
  function annulus(inner, outer, segments, y) {
    const m = emptyMesh();
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
      m.position.push(inner * c, y || 0, inner * si);  m.normal.push(0,1,0); m.uv.push(s/segments, 0);
      m.position.push(outer * c, y || 0, outer * si);  m.normal.push(0,1,0); m.uv.push(s/segments, 1);
    }
    for (let s = 0; s < segments; s++) {
      const a = s * 2;
      m.index.push(a, a+2, a+1, a+1, a+2, a+3);
    }
    return m;
  }

  /* ---------------------------------------------------------------- textures */

  function tileNoise(size, freq, octaves, seed) {
    const out = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const f = freq * (1 << o);
      const rnd = mulberry32(seed + o * 7919);
      const lat = new Float32Array(f * f);
      for (let i = 0; i < f * f; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * f, y0 = Math.floor(fy), ty = smoothstep(fy - y0);
        const y0i = ((y0 % f) + f) % f, y1i = (y0i + 1) % f;
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * f, x0 = Math.floor(fx), tx = smoothstep(fx - x0);
          const x0i = ((x0 % f) + f) % f, x1i = (x0i + 1) % f;
          const v = lerp(lerp(lat[y0i*f+x0i], lat[y0i*f+x1i], tx),
                         lerp(lat[y1i*f+x0i], lat[y1i*f+x1i], tx), ty);
          out[y * size + x] += v * amp;
        }
      }
      total += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  function canvas2d(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function hexToRgb(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /** Ground texture for a biome: base + patches + speckle + faint mow stripes. */
  function groundTexture(pal, seed) {
    const S = 512;
    const c = canvas2d(S, S), ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const n1 = tileNoise(S, 4, 4, seed);
    const n2 = tileNoise(S, 16, 3, seed + 101);
    const n3 = tileNoise(S, 64, 2, seed + 202);
    const a = hexToRgb(pal.groundA), b = hexToRgb(pal.groundB), d = hexToRgb(pal.groundC);
    for (let i = 0; i < S * S; i++) {
      const x = i % S, y = (i / S) | 0;
      let t = clamp(n1[i] * 1.25 - 0.12, 0, 1);
      let s = n2[i], g = n3[i];
      const stripe = 0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 6);
      let r0 = lerp(a[0], b[0], t), g0 = lerp(a[1], b[1], t), b0 = lerp(a[2], b[2], t);
      const dk = clamp((s - 0.55) * 2.2, 0, 1);
      r0 = lerp(r0, d[0], dk * 0.75); g0 = lerp(g0, d[1], dk * 0.75); b0 = lerp(b0, d[2], dk * 0.75);
      const sp = (g - 0.5) * 26 + (stripe - 0.5) * 7;
      const j = i * 4;
      img.data[j]   = clamp(r0 + sp, 0, 255);
      img.data[j+1] = clamp(g0 + sp, 0, 255);
      img.data[j+2] = clamp(b0 + sp, 0, 255);
      img.data[j+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Soft round sprite: shadows, glows, smoke. */
  function softDot(size, inner, outer) {
    const c = canvas2d(size, size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0, 'rgba(255,255,255,' + (inner === undefined ? 1 : inner) + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,' + (outer === undefined ? 0.45 : outer) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
  }

  /** Grass tuft alpha sprite. */
  function grassBlade() {
    const S = 64, c = canvas2d(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const rnd = mulberry32(4242);
    for (let i = 0; i < 9; i++) {
      const x = 6 + rnd() * (S - 12), h = S * (0.5 + rnd() * 0.5), w = 2 + rnd() * 2.5;
      const bend = (rnd() - 0.5) * 18;
      const shade = 165 + rnd() * 80;
      ctx.strokeStyle = 'rgba(' + (shade * 0.66 | 0) + ',' + shade + ',' + (shade * 0.55 | 0) + ',0.95)';
      ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, S);
      ctx.quadraticCurveTo(x + bend * 0.4, S - h * 0.6, x + bend, S - h);
      ctx.stroke();
    }
    return c;
  }

  /** Confetti sprite - a soft square with rounded corners. */
  function confetti() {
    const S = 32, c = canvas2d(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    const r = 5, p = 3;
    ctx.moveTo(p + r, p);
    ctx.arcTo(S - p, p, S - p, S - p, r);
    ctx.arcTo(S - p, S - p, p, S - p, r);
    ctx.arcTo(p, S - p, p, p, r);
    ctx.arcTo(p, p, S - p, p, r);
    ctx.fill();
    return c;
  }

  /** Kiosk sign face. */
  function signCanvas(o) {
    const W = 512, H = 288;
    const c = canvas2d(W, H), ctx = c.getContext('2d');
    const accent = o.accent || '#ffd24a';
    ctx.clearRect(0, 0, W, H);
    // panel
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(16,22,32,0.94)');
    g.addColorStop(1, 'rgba(8,12,20,0.96)');
    roundRect(ctx, 6, 6, W - 12, H - 12, 26); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = o.locked ? '#4b5563' : accent; ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(o.title, W / 2, 62);

    ctx.font = '30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillStyle = 'rgba(210,225,245,0.85)';
    ctx.fillText(o.desc || '', W / 2, 112);

    // level pips
    const pips = o.maxLevel, pw = (W - 120) / pips, py = 156;
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = i < o.level ? accent : 'rgba(255,255,255,0.15)';
      roundRect(ctx, 60 + i * pw + 1.5, py, pw - 3, 12, 5); ctx.fill();
    }

    ctx.font = 'bold 46px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    if (o.locked) {
      ctx.fillStyle = '#9aa4ad';
      ctx.fillText(o.lockText || 'LOCKED', W / 2, 226);
    } else if (o.level >= o.maxLevel) {
      ctx.fillStyle = accent;
      ctx.fillText('MAX LEVEL', W / 2, 226);
    } else {
      ctx.fillStyle = o.afford ? '#7dffa8' : '#ff8080';
      ctx.fillText(o.price, W / 2, 222);
      ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = 'rgba(200,215,235,0.7)';
      ctx.fillText('Lv ' + o.level + ' / ' + o.maxLevel, W / 2, 258);
    }
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Big text banner used for the arena portal. */
  function bannerCanvas(title, sub, accent) {
    const W = 512, H = 160;
    const c = canvas2d(W, H), ctx = c.getContext('2d');
    roundRect(ctx, 4, 4, W - 8, H - 8, 22);
    ctx.fillStyle = 'rgba(10,14,22,0.92)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = accent; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 50px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(title, W / 2, 60);
    ctx.font = '28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(sub, W / 2, 112);
    return c;
  }

  BPT.Assets = {
    sphere, balloon, cone, cylinder, disc, box, quad, crossedQuads, plane, annulus, lathe,
    tileNoise, groundTexture, softDot, grassBlade, confetti, signCanvas, bannerCanvas,
    canvas2d, roundRect, hexToRgb,
  };
})(window.BPT = window.BPT || {});
