/* Thin WebGL2 helpers: programs, meshes, instancing, textures, framebuffers. */
(function (BPT) {
  'use strict';

  function compile(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error('Shader compile failed [' + name + ']\n' + log + '\n' + numbered(src));
      throw new Error('shader ' + name + ': ' + log);
    }
    return sh;
  }
  function numbered(src) {
    return src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
  }

  class Program {
    constructor(gl, vs, fs, name) {
      this.gl = gl; this.name = name || 'prog';
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, this.name + '.vs'));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, this.name + '.fs'));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('link ' + this.name + ': ' + gl.getProgramInfoLog(p));
      }
      this.p = p;
      this.u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const nm = info.name.replace(/\[0\]$/, '');
        this.u[nm] = gl.getUniformLocation(p, nm);
      }
      this.a = {};
      const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < na; i++) {
        const info = gl.getActiveAttrib(p, i);
        this.a[info.name] = gl.getAttribLocation(p, info.name);
      }
    }
    use() { this.gl.useProgram(this.p); return this; }
    m4(n, v) { if (this.u[n]) this.gl.uniformMatrix4fv(this.u[n], false, v); return this; }
    f(n, v) { if (this.u[n]) this.gl.uniform1f(this.u[n], v); return this; }
    i(n, v) { if (this.u[n]) this.gl.uniform1i(this.u[n], v); return this; }
    v2(n, x, y) { if (this.u[n]) this.gl.uniform2f(this.u[n], x, y); return this; }
    v3(n, x, y, z) { if (this.u[n]) this.gl.uniform3f(this.u[n], x, y, z); return this; }
    v4(n, x, y, z, w) { if (this.u[n]) this.gl.uniform4f(this.u[n], x, y, z, w); return this; }
    tex(n, unit, texture, target) {
      const gl = this.gl;
      if (!this.u[n]) return this;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target || gl.TEXTURE_2D, texture);
      gl.uniform1i(this.u[n], unit);
      return this;
    }
  }

  /* mesh: {position:[], normal:[], uv:[], index:[]} */
  class Mesh {
    constructor(gl, data) {
      this.gl = gl;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.buffers = {};
      const attach = (loc, arr, size) => {
        if (!arr) return;
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        this.buffers[loc] = b;
      };
      attach(0, data.position, 3);
      attach(1, data.normal, 3);
      attach(2, data.uv, 2);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.index), gl.STATIC_DRAW);
      this.count = data.index.length;
      this.instBuffers = [];
      gl.bindVertexArray(null);
    }
    /* layout: [{loc, size}] packed into one interleaved buffer, divisor 1 */
    addInstanceBuffer(layout, maxInstances) {
      const gl = this.gl;
      const stride = layout.reduce((s, l) => s + l.size, 0);
      const buf = gl.createBuffer();
      const data = new Float32Array(stride * maxInstances);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      let off = 0;
      for (const l of layout) {
        gl.enableVertexAttribArray(l.loc);
        gl.vertexAttribPointer(l.loc, l.size, gl.FLOAT, false, stride * 4, off * 4);
        gl.vertexAttribDivisor(l.loc, 1);
        off += l.size;
      }
      gl.bindVertexArray(null);
      const rec = { buf, data, stride, max: maxInstances, n: 0 };
      this.instBuffers.push(rec);
      return rec;
    }
    uploadInstances(rec, n) {
      const gl = this.gl;
      rec.n = n;
      if (!n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, rec.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, rec.data, 0, n * rec.stride);
    }
    draw() {
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }
    drawInstanced(n) {
      if (!n) return;
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0, n);
    }
  }

  function texFromCanvas(gl, canvas, opts) {
    opts = opts || {};
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const wrap = opts.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (opts.mipmap !== false) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return t;
  }

  function updateTexFromCanvas(gl, tex, canvas, mipmap) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  }

  class Target {
    constructor(gl, w, h, float) {
      this.gl = gl; this.w = w; this.h = h; this.float = !!float;
      this.fbo = gl.createFramebuffer();
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.depth = null;
      this.resize(w, h);
    }
    resize(w, h) {
      const gl = this.gl;
      this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.w, this.h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      if (this.withDepth) {
        if (!this.depth) this.depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.w, this.h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    enableDepth() {
      this.withDepth = true;
      this.resize(this.w, this.h);
      return this;
    }
    bind() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.w, this.h);
    }
  }

  BPT.GL = { Program, Mesh, Target, texFromCanvas, updateTexFromCanvas };
})(window.BPT = window.BPT || {});
