/* WebGL2 renderer: procedural sky, lit instanced geometry, decals, billboards,
   grass, world-space signs, and a bloom/vignette post pass. */
(function (BPT) {
  'use strict';
  const { M4, clamp } = BPT;
  const { Program, Mesh, Target, texFromCanvas, updateTexFromCanvas } = BPT.GL;
  const A = BPT.Assets;

  const H = '#version 300 es\nprecision highp float;\n';

  /* --------------------------------------------------------------- shaders */

  const SRGB = `
    vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }`;

  const COMMON_FOG = SRGB + `
    uniform vec3 uFogColor; uniform float uFogDensity;
    vec3 applyFog(vec3 col, float dist) {
      float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
      return mix(col, toLinear(uFogColor), clamp(f, 0.0, 1.0));
    }`;

  const LIGHT_UNIFORMS = `
    uniform vec3 uLightDir; uniform vec3 uLightColor; uniform vec3 uAmbient;
    uniform float uLightInt; uniform vec3 uCamPos;`;

  const SKY_VS = H + `
    out vec2 vNdc;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      vNdc = p * 2.0 - 1.0;
      gl_Position = vec4(vNdc, 1.0, 1.0);
    }`;

  const SKY_FS = H + SRGB + `
    in vec2 vNdc;
    out vec4 frag;
    uniform mat4 uInvVP; uniform vec3 uCamPos; uniform float uTime;
    uniform vec3 uZenith, uHorizon, uSunColor, uSunDir, uCloudTint;
    uniform float uCloud, uStar;

    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      vec4 far = uInvVP * vec4(vNdc, 1.0, 1.0);
      vec3 dir = normalize(far.xyz / far.w - uCamPos);
      float h = clamp(dir.y, -1.0, 1.0);
      float t = pow(clamp(h * 1.05 + 0.02, 0.0, 1.0), 0.55);
      vec3 col = toLinear(mix(uHorizon, uZenith, t));

      // stars (night arenas)
      if (uStar > 0.0 && dir.y > 0.0) {
        vec2 sp = dir.xz / max(dir.y + 0.35, 0.05) * 3.0;
        float s = hash(floor(sp * 60.0));
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
        col += vec3(0.9, 0.93, 1.0) * step(0.9965, s) * uStar * tw * smoothstep(0.0, 0.35, dir.y);
      }

      // sun + glow
      float sd = max(dot(dir, normalize(uSunDir)), 0.0);
      col += toLinear(uSunColor) * (pow(sd, 16000.0) * 20.0 + pow(sd, 500.0) * 0.5 + pow(sd, 22.0) * 0.12);

      // clouds on a virtual plane
      if (uCloud > 0.01 && dir.y > 0.012) {
        vec2 uv = dir.xz / dir.y;
        vec2 p = uv * 0.055 + vec2(uTime * 0.0055, uTime * 0.0022);
        float n = fbm(p);
        float n2 = fbm(p * 2.4 + 7.3);
        float cov = smoothstep(0.52 - uCloud * 0.18, 0.78, n * 0.75 + n2 * 0.25);
        float edge = smoothstep(0.0, 0.16, dir.y);
        float lit = smoothstep(0.35, 0.85, n2);
        vec3 cl = toLinear(mix(uCloudTint * 0.50, uCloudTint * 1.05, lit));
        cl += toLinear(uSunColor) * pow(sd, 8.0) * 0.30;
        col = mix(col, cl, cov * edge * clamp(uCloud, 0.0, 1.0) * 0.92);
      }
      frag = vec4(col, 1.0);
    }`;

  const GROUND_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 aUv;
    uniform mat4 uVP; uniform vec3 uCamPos;
    out vec2 vUv; out vec3 vWorld;
    void main() {
      vec3 w = aPos + vec3(uCamPos.x, 0.0, uCamPos.z);
      vWorld = w;
      vUv = aUv + vec2(uCamPos.x, uCamPos.z) / 8.0;
      gl_Position = uVP * vec4(w, 1.0);
    }`;

  const GROUND_FS = H + LIGHT_UNIFORMS + COMMON_FOG + `
    in vec2 vUv; in vec3 vWorld;
    out vec4 frag;
    uniform sampler2D uTex;
    uniform vec3 uPlazaTint; uniform float uPlazaRadius; uniform vec3 uRimColor;
    void main() {
      vec3 base = toLinear(texture(uTex, vUv).rgb);
      float d = length(vWorld.xz);
      float inside = smoothstep(uPlazaRadius + 0.35, uPlazaRadius - 0.45, d);
      vec3 pl = toLinear(uPlazaTint);
      // concentric paving rings + radial spokes, so the plaza reads as built
      float rings = 0.5 + 0.5 * sin(d * 2.0943951);
      pl *= 0.9 + 0.12 * rings;
      float ang = atan(vWorld.z, vWorld.x);
      float spokes = smoothstep(0.965, 1.0, abs(sin(ang * 8.0)));
      pl = mix(pl, pl * 1.22, spokes);
      float inner = smoothstep(0.30, 0.0, abs(d - uPlazaRadius * 0.62));
      pl = mix(pl, pl * 1.3, inner);
      base = mix(base, pl, inside * 0.9);
      vec3 col = base * (uAmbient + uLightColor * uLightInt * 0.62);
      float rim = smoothstep(0.38, 0.0, abs(d - uPlazaRadius));
      col += toLinear(uRimColor) * rim * 0.85;
      frag = vec4(applyFog(col, length(vWorld - uCamPos)), 1.0);
    }`;

  const INST_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 aUv;
    layout(location=3) in vec4 iPos;     // xyz, uniform scale
    layout(location=4) in vec4 iColor;   // rgb, emissive
    layout(location=5) in vec4 iParam;   // yaw, scaleY ratio, glow, scaleZ ratio
    uniform mat4 uVP;
    out vec3 vN; out vec3 vW; out vec4 vColor; out float vGlow; out vec2 vUv;
    void main() {
      float c = cos(iParam.x), s = sin(iParam.x);
      vec3 sc = vec3(iPos.w, iPos.w * iParam.y, iPos.w * iParam.w);
      vec3 p = aPos * sc;
      vec3 nn = aNormal / max(sc, vec3(0.0001));
      vec3 r = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
      vec3 n = vec3(c * nn.x + s * nn.z, nn.y, -s * nn.x + c * nn.z);
      vW = r + iPos.xyz;
      vN = normalize(n);
      vColor = iColor; vGlow = iParam.z; vUv = aUv;
      gl_Position = uVP * vec4(vW, 1.0);
    }`;

  const INST_FS = H + LIGHT_UNIFORMS + COMMON_FOG + `
    in vec3 vN; in vec3 vW; in vec4 vColor; in float vGlow; in vec2 vUv;
    out vec4 frag;
    uniform float uGloss;
    void main() {
      vec3 N = normalize(vN);
      vec3 L = normalize(uLightDir);
      vec3 V = normalize(uCamPos - vW);
      float ndl = max(dot(N, L), 0.0);
      float wrap = max((dot(N, L) + 0.35) / 1.35, 0.0);
      vec3 base = toLinear(vColor.rgb);
      vec3 col = base * (uAmbient + uLightColor * uLightInt * mix(ndl, wrap, 0.55));
      // translucency: light bleeding through the latex
      col += base * uLightColor * max(dot(-N, L), 0.0) * 0.28 * uGloss;
      // rim
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += mix(base, vec3(1.0), 0.34) * rim * 0.34 * uGloss;
      // specular highlight
      vec3 Hv = normalize(L + V);
      col += uLightColor * pow(max(dot(N, Hv), 0.0), 64.0) * 0.9 * uGloss;
      col += base * vColor.a;                       // emissive
      col = applyFog(col, length(vW - uCamPos));
      col += base * vGlow;                          // bloom seed, added after fog
      frag = vec4(col, 1.0);
    }`;

  const DECAL_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec2 aUv;
    layout(location=3) in vec4 iPos;
    layout(location=4) in vec4 iColor;
    uniform mat4 uVP;
    out vec2 vUv; out vec4 vColor; out vec3 vW;
    void main() {
      vec3 p = vec3(aPos.x * iPos.w, 0.0, aPos.y * iPos.w) + iPos.xyz;
      vW = p; vUv = aUv; vColor = iColor;
      gl_Position = uVP * vec4(p, 1.0);
    }`;

  const DECAL_FS = H + COMMON_FOG + `
    in vec2 vUv; in vec4 vColor; in vec3 vW;
    out vec4 frag;
    uniform sampler2D uTex; uniform vec3 uCamPos;
    void main() {
      float a = texture(uTex, vUv).a * vColor.a;
      float fog = 1.0 - exp(-pow(length(vW - uCamPos) * uFogDensity, 2.0));
      frag = vec4(vColor.rgb, a * (1.0 - clamp(fog, 0.0, 1.0)));
    }`;

  const BILL_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec2 aUv;
    layout(location=3) in vec4 iPos;    // xyz, size
    layout(location=4) in vec4 iColor;  // rgba
    layout(location=5) in vec4 iParam;  // rotation, aspect, -, -
    uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp;
    out vec2 vUv; out vec4 vColor; out vec3 vW;
    void main() {
      float c = cos(iParam.x), s = sin(iParam.x);
      vec2 q = vec2(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c) * iPos.w;
      vec3 p = iPos.xyz + uRight * q.x * iParam.y + uUp * q.y;
      vW = p; vUv = aUv; vColor = iColor;
      gl_Position = uVP * vec4(p, 1.0);
    }`;

  const BILL_FS = H + SRGB + `
    in vec2 vUv; in vec4 vColor; in vec3 vW;
    out vec4 frag;
    uniform sampler2D uTex; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCamPos;
    void main() {
      vec4 t = texture(uTex, vUv);
      float fog = clamp(1.0 - exp(-pow(length(vW - uCamPos) * uFogDensity, 2.0)), 0.0, 1.0);
      frag = vec4(toLinear(vColor.rgb) * t.rgb, t.a * vColor.a * (1.0 - fog * 0.85));
    }`;

  const GRASS_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec2 aUv;
    layout(location=3) in vec4 iPos;
    layout(location=4) in vec4 iColor;
    layout(location=5) in vec4 iParam;
    uniform mat4 uVP; uniform float uTime;
    out vec2 vUv; out vec4 vColor; out vec3 vW;
    void main() {
      float c = cos(iParam.x), s = sin(iParam.x);
      vec3 p = aPos * iPos.w;
      vec3 r = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iPos.xyz;
      float sway = sin(uTime * 1.7 + iParam.w * 6.28) * 0.16 * aPos.y;
      r.x += sway; r.z += sway * 0.6;
      vW = r; vUv = aUv; vColor = iColor;
      gl_Position = uVP * vec4(r, 1.0);
    }`;

  const GRASS_FS = H + LIGHT_UNIFORMS + COMMON_FOG + `
    in vec2 vUv; in vec4 vColor; in vec3 vW;
    out vec4 frag;
    uniform sampler2D uTex;
    void main() {
      vec4 t = texture(uTex, vUv);
      if (t.a < 0.35) discard;
      vec3 col = toLinear(t.rgb) * toLinear(vColor.rgb) * (uAmbient + uLightColor * uLightInt * 0.68);
      frag = vec4(applyFog(col, length(vW - uCamPos)), 1.0);
    }`;

  const SIGN_VS = H + `
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec2 aUv;
    uniform mat4 uVP; uniform mat4 uModel;
    out vec2 vUv; out vec3 vW;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vW = w.xyz; vUv = aUv;
      gl_Position = uVP * w;
    }`;

  const SIGN_FS = H + SRGB + `
    in vec2 vUv; in vec3 vW;
    out vec4 frag;
    uniform sampler2D uTex; uniform vec3 uFogColor; uniform float uFogDensity;
    uniform vec3 uCamPos; uniform float uGlow;
    void main() {
      vec4 t = texture(uTex, vUv);
      if (t.a < 0.02) discard;
      float fog = clamp(1.0 - exp(-pow(length(vW - uCamPos) * uFogDensity, 2.0)), 0.0, 1.0);
      vec3 col = mix(toLinear(t.rgb) * (1.0 + uGlow * 2.0), toLinear(uFogColor), fog * 0.9);
      frag = vec4(col, t.a);
    }`;

  const FS_QUAD_VS = H + `
    out vec2 vUv;
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      vUv = p;
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  const BRIGHT_FS = H + `
    in vec2 vUv; out vec4 frag;
    uniform sampler2D uTex; uniform float uThreshold;
    void main() {
      vec3 c = texture(uTex, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      frag = vec4(c * smoothstep(uThreshold, uThreshold + 0.7, l), 1.0);
    }`;

  const BLUR_FS = H + `
    in vec2 vUv; out vec4 frag;
    uniform sampler2D uTex; uniform vec2 uDir;
    void main() {
      vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
      s += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
      s += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
      s += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
      s += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
      frag = vec4(s, 1.0);
    }`;

  const POST_FS = H + `
    in vec2 vUv; out vec4 frag;
    uniform sampler2D uScene; uniform sampler2D uBloom;
    uniform float uBloomAmt; uniform float uVignette; uniform float uExposure;
    uniform float uFlash; uniform vec3 uFlashColor;
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }
    void main() {
      vec3 c = texture(uScene, vUv).rgb;
      c += texture(uBloom, vUv).rgb * uBloomAmt;
      c *= uExposure;
      c = aces(c);
      c = mix(c, uFlashColor, uFlash);
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette;
      c *= clamp(v, 0.0, 1.0);
      frag = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
    }`;

  /* -------------------------------------------------------------- renderer */

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        antialias: true, alpha: false, depth: true,
        powerPreference: 'high-performance', preserveDrawingBuffer: false,
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      this.canvas = canvas; this.gl = gl;
      this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
      this.emptyVao = gl.createVertexArray();

      this.prog = {
        sky:   new Program(gl, SKY_VS, SKY_FS, 'sky'),
        ground:new Program(gl, GROUND_VS, GROUND_FS, 'ground'),
        inst:  new Program(gl, INST_VS, INST_FS, 'inst'),
        decal: new Program(gl, DECAL_VS, DECAL_FS, 'decal'),
        bill:  new Program(gl, BILL_VS, BILL_FS, 'bill'),
        grass: new Program(gl, GRASS_VS, GRASS_FS, 'grass'),
        sign:  new Program(gl, SIGN_VS, SIGN_FS, 'sign'),
        bright:new Program(gl, FS_QUAD_VS, BRIGHT_FS, 'bright'),
        blur:  new Program(gl, FS_QUAD_VS, BLUR_FS, 'blur'),
        post:  new Program(gl, FS_QUAD_VS, POST_FS, 'post'),
      };

      const IL = [{ loc: 3, size: 4 }, { loc: 4, size: 4 }, { loc: 5, size: 4 }];
      this.mesh = {
        balloon:   new Mesh(gl, A.balloon(24, 30)),
        sphere:    new Mesh(gl, A.sphere(18, 12)),
        lowSphere: new Mesh(gl, A.sphere(10, 7)),
        cone:      new Mesh(gl, A.cone(1, 1, 12)),
        cyl:       new Mesh(gl, A.cylinder(1, 1, 12)),
        box:       new Mesh(gl, A.box(1, 1, 1)),
        plaza:     new Mesh(gl, A.cylinder(1, 1, 72)),
        ring:      new Mesh(gl, A.annulus(0.90, 1.0, 96, 0)),
        quadDecal: new Mesh(gl, A.quad(1, 1)),
        quadBill:  new Mesh(gl, A.quad(1, 1)),
        quad:      new Mesh(gl, A.quad(1, 1)),
        ground:    new Mesh(gl, A.plane(760, 48)),
        grass:     new Mesh(gl, A.crossedQuads(1, 1)),
      };
      this.inst = {
        balloon: this.mesh.balloon.addInstanceBuffer(IL, 340),
        sphere:  this.mesh.sphere.addInstanceBuffer(IL, 160),
        low:     this.mesh.lowSphere.addInstanceBuffer(IL, 460),
        cone:    this.mesh.cone.addInstanceBuffer(IL, 460),
        cyl:     this.mesh.cyl.addInstanceBuffer(IL, 460),
        box:     this.mesh.box.addInstanceBuffer(IL, 160),
        plaza:   this.mesh.plaza.addInstanceBuffer(IL, 8),
        ring:    this.mesh.ring.addInstanceBuffer(IL, 8),
        decal:   this.mesh.quadDecal.addInstanceBuffer(IL, 460),
        bill:    this.mesh.quadBill.addInstanceBuffer(IL, 900),
        grass:   this.mesh.grass.addInstanceBuffer(IL, 2600),
      };

      this.tex = {
        dot:      texFromCanvas(gl, A.softDot(128, 1, 0.35), { clamp: true }),
        shadow:   texFromCanvas(gl, A.softDot(128, 0.95, 0.28), { clamp: true }),
        confetti: texFromCanvas(gl, A.confetti(), { clamp: true }),
        grass:    texFromCanvas(gl, A.grassBlade(), { clamp: true }),
        ground:   null,
      };

      this.sceneT = new Target(gl, 2, 2, this.floatOK).enableDepth();
      this.brightT = new Target(gl, 2, 2, this.floatOK);
      this.blurA = new Target(gl, 2, 2, this.floatOK);
      this.blurB = new Target(gl, 2, 2, this.floatOK);

      this.vp = M4.create(); this.view = M4.create(); this.proj = M4.create(); this.invVP = M4.create();
      this.quality = { scale: 1, bloom: 1, grass: 1 };
      this.flash = 0; this.flashColor = [1, 1, 1];
      this.signTex = new Map();
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    setArena(arena) {
      const gl = this.gl;
      this.arena = arena;
      const canvas = A.groundTexture(arena.ground, arena.id.length * 977 + 13);
      if (this.tex.ground) gl.deleteTexture(this.tex.ground);
      this.tex.ground = texFromCanvas(gl, canvas, { mipmap: true });
    }

    /** Upload (or refresh) a kiosk sign texture. */
    setSign(key, canvas) {
      const gl = this.gl;
      let t = this.signTex.get(key);
      if (!t) { t = texFromCanvas(gl, canvas, { clamp: true, mipmap: false }); this.signTex.set(key, t); }
      else updateTexFromCanvas(gl, t, canvas, false);
      return t;
    }

    resize() {
      const gl = this.gl, c = this.canvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(c.clientWidth * dpr * this.quality.scale));
      const h = Math.max(2, Math.round(c.clientHeight * dpr * this.quality.scale));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      if (this.sceneT.w !== w || this.sceneT.h !== h) {
        this.sceneT.resize(w, h);
        const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
        this.brightT.resize(bw, bh); this.blurA.resize(bw, bh); this.blurB.resize(bw, bh);
      }
      this.aspect = w / h;
    }

    setCamera(pos, yaw, pitch, fovDeg) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dir = [cp * Math.sin(yaw), sp, -cp * Math.cos(yaw)];
      this.camPos = pos; this.camDir = dir;
      this.camRight = [Math.cos(yaw), 0, Math.sin(yaw)];
      this.camUp = [
        this.camRight[1] * dir[2] - this.camRight[2] * dir[1],
        this.camRight[2] * dir[0] - this.camRight[0] * dir[2],
        this.camRight[0] * dir[1] - this.camRight[1] * dir[0],
      ];
      M4.perspective(this.proj, fovDeg * Math.PI / 180, this.aspect, 0.08, 900);
      M4.lookAt(this.view, pos, [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]], [0, 1, 0]);
      M4.multiply(this.vp, this.proj, this.view);
      M4.invert(this.invVP, this.vp);
    }

    _lightUniforms(p) {
      const a = this.arena;
      p.v3('uLightDir', a.light.dir[0], a.light.dir[1], a.light.dir[2])
       .v3('uLightColor', a.light.color[0], a.light.color[1], a.light.color[2])
       .v3('uAmbient', a.light.ambient[0], a.light.ambient[1], a.light.ambient[2])
       .f('uLightInt', a.light.intensity)
       .v3('uCamPos', this.camPos[0], this.camPos[1], this.camPos[2])
       .v3('uFogColor', a.fog.color[0], a.fog.color[1], a.fog.color[2])
       .f('uFogDensity', a.fog.density)
       .m4('uVP', this.vp);
    }

    begin(time) {
      const gl = this.gl;
      this.time = time;
      this.sceneT.bind();
      gl.clearColor(0, 0, 0, 1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // sky
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      const a = this.arena, p = this.prog.sky.use();
      gl.bindVertexArray(this.emptyVao);
      p.m4('uInvVP', this.invVP)
       .v3('uCamPos', this.camPos[0], this.camPos[1], this.camPos[2])
       .f('uTime', time)
       .v3('uZenith', a.sky.zenith[0], a.sky.zenith[1], a.sky.zenith[2])
       .v3('uHorizon', a.sky.horizon[0], a.sky.horizon[1], a.sky.horizon[2])
       .v3('uSunColor', a.sky.sun[0], a.sky.sun[1], a.sky.sun[2])
       .v3('uSunDir', a.sky.sunDir[0], a.sky.sunDir[1], a.sky.sunDir[2])
       .v3('uCloudTint', a.sky.cloudTint[0], a.sky.cloudTint[1], a.sky.cloudTint[2])
       .f('uCloud', a.sky.cloud).f('uStar', a.sky.star);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    }

    drawGround(plazaRadius, tint, rim) {
      const p = this.prog.ground.use();
      this._lightUniforms(p);
      p.tex('uTex', 0, this.tex.ground)
       .v3('uPlazaTint', tint[0], tint[1], tint[2])
       .v3('uRimColor', rim[0], rim[1], rim[2])
       .f('uPlazaRadius', plazaRadius);
      this.mesh.ground.draw();
    }

    drawInstanced(meshKey, instKey, n, gloss) {
      if (!n) return;
      const p = this.prog.inst.use();
      this._lightUniforms(p);
      p.f('uGloss', gloss === undefined ? 1 : gloss);
      this.mesh[meshKey].uploadInstances(this.inst[instKey], n);
      this.mesh[meshKey].drawInstanced(n);
    }

    drawGrass(n) {
      if (!n || !this.quality.grass) return;
      const gl = this.gl;
      gl.disable(gl.CULL_FACE);
      const p = this.prog.grass.use();
      this._lightUniforms(p);
      p.tex('uTex', 0, this.tex.grass).f('uTime', this.time);
      this.mesh.grass.uploadInstances(this.inst.grass, n);
      this.mesh.grass.drawInstanced(n);
      gl.enable(gl.CULL_FACE);
    }

    drawDecals(n) {
      if (!n) return;
      const gl = this.gl;
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const a = this.arena, p = this.prog.decal.use();
      p.m4('uVP', this.vp)
       .v3('uCamPos', this.camPos[0], this.camPos[1], this.camPos[2])
       .v3('uFogColor', a.fog.color[0], a.fog.color[1], a.fog.color[2])
       .f('uFogDensity', a.fog.density)
       .tex('uTex', 0, this.tex.shadow);
      this.mesh.quadDecal.uploadInstances(this.inst.decal, n);
      this.mesh.quadDecal.drawInstanced(n);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    drawSign(model, tex, glow) {
      const gl = this.gl;
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const a = this.arena, p = this.prog.sign.use();
      p.m4('uVP', this.vp).m4('uModel', model)
       .v3('uCamPos', this.camPos[0], this.camPos[1], this.camPos[2])
       .v3('uFogColor', a.fog.color[0], a.fog.color[1], a.fog.color[2])
       .f('uFogDensity', a.fog.density)
       .f('uGlow', glow || 0)
       .tex('uTex', 0, tex);
      this.mesh.quad.draw();
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    drawBillboards(n, texture, additive) {
      if (!n) return;
      const gl = this.gl;
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      const a = this.arena, p = this.prog.bill.use();
      p.m4('uVP', this.vp)
       .v3('uRight', this.camRight[0], this.camRight[1], this.camRight[2])
       .v3('uUp', this.camUp[0], this.camUp[1], this.camUp[2])
       .v3('uCamPos', this.camPos[0], this.camPos[1], this.camPos[2])
       .v3('uFogColor', a.fog.color[0], a.fog.color[1], a.fog.color[2])
       .f('uFogDensity', a.fog.density)
       .tex('uTex', 0, texture);
      this.mesh.quadBill.uploadInstances(this.inst.bill, n);
      this.mesh.quadBill.drawInstanced(n);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    end(exposure) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.emptyVao);

      const bloom = this.quality.bloom;
      if (bloom > 0) {
        this.brightT.bind();
        this.prog.bright.use().tex('uTex', 0, this.sceneT.tex).f('uThreshold', 1.05);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        let src = this.brightT;
        for (let i = 0; i < 2; i++) {
          this.blurA.bind();
          this.prog.blur.use().tex('uTex', 0, src.tex).v2('uDir', 1 / this.blurA.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          this.blurB.bind();
          this.prog.blur.use().tex('uTex', 0, this.blurA.tex).v2('uDir', 0, 1 / this.blurB.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          src = this.blurB;
        }
        this.bloomTex = this.blurB.tex;
      } else {
        this.bloomTex = this.brightT.tex;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.prog.post.use()
        .tex('uScene', 0, this.sceneT.tex)
        .tex('uBloom', 1, this.bloomTex)
        .f('uBloomAmt', bloom * 0.62)
        .f('uVignette', 0.62)
        .f('uExposure', exposure || 1.0)
        .f('uFlash', this.flash)
        .v3('uFlashColor', this.flashColor[0], this.flashColor[1], this.flashColor[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    }
  }

  BPT.Renderer = Renderer;
})(window.BPT = window.BPT || {});
