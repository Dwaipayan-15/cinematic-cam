// webgl_laptop.js — GPU color grading on laptop preview canvas

const VERT = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main(){ v_uv=a_uv; gl_Position=vec4(a_pos,0,1); }
`;

const FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform mat3  u_mat;
  uniform vec3  u_lift, u_gamma, u_gain;
  uniform vec3  u_stint, u_htint;
  uniform float u_sstr, u_hstr;
  uniform float u_haln, u_fbase, u_sat, u_con, u_temp;
  uniform float u_exp, u_satAdj, u_conAdj, u_liftAdj, u_gainAdj;
  uniform float u_vig, u_grain, u_time, u_chrab;

  float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }

  vec3 lgg(vec3 c, vec3 lift, vec3 gamma, vec3 gain){
    c = c*(1.0-lift)+lift;
    c = pow(max(c,0.0), 1.0/gamma);
    return c*gain;
  }

  vec3 splitTone(vec3 c, vec3 st, vec3 ht, float ss, float hs){
    float l=luma(c);
    float sm=1.0-smoothstep(0.0,0.5,l);
    float hm=smoothstep(0.5,1.0,l);
    c=mix(c,c*st*2.0,sm*ss);
    c=mix(c,c*ht,    hm*hs);
    return c;
  }

  vec3 halation(vec3 c, vec2 uv, float str){
    if(str<0.001) return c;
    vec3 blur=vec3(0.0); float tot=0.0;
    for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++){
      vec2 off=vec2(float(x),float(y))*0.005;
      blur+=texture2D(u_tex,clamp(uv+off,0.0,1.0)).rgb;
      tot+=1.0;
    }
    blur/=tot;
    float b=smoothstep(0.65,1.0,luma(blur));
    return c+vec3(b*1.3,b*0.4,b*0.1)*str;
  }

  float grain2(vec2 uv, float t){
    vec2 p=uv*vec2(1920.0,1080.0);
    return fract(sin(dot(p+t*100.0,vec2(12.9898,78.233)))*43758.5453)*2.0-1.0;
  }

  vec3 chromAb(sampler2D tex, vec2 uv, float s){
    vec2 d=(uv-0.5)*s;
    return vec3(texture2D(tex,uv+d).r, texture2D(tex,uv).g, texture2D(tex,uv-d).b);
  }

  float vignette(vec2 uv, float s){
    vec2 d=uv-0.5; return 1.0-dot(d,d)*s*3.5;
  }

  void main(){
    vec2 uv=v_uv;
    vec3 c = u_chrab>0.001 ? chromAb(u_tex,uv,u_chrab) : texture2D(u_tex,uv).rgb;

    // Color matrix
    c = u_mat * c;

    // Exposure
    c *= pow(2.0, u_exp);

    // Film base (lifted blacks)
    float fb = u_fbase + u_liftAdj*0.02;
    c = c + fb*(1.0-c);

    // LGG + manual gain
    vec3 gainMod = u_gain * (u_gainAdj/100.0);
    c = lgg(c, u_lift, u_gamma, gainMod);

    // Split toning
    c = splitTone(c, u_stint, u_htint, u_sstr, u_hstr);

    // Saturation
    float l=luma(c);
    c = mix(vec3(l), c, u_sat*u_satAdj);

    // Contrast
    c = (c-0.5)*(u_con*u_conAdj)+0.5;

    // Temperature
    float t=u_temp;
    c.r+=t; c.b-=t;

    // Halation
    c = halation(c, uv, u_haln);

    // Vignette
    c *= vignette(uv, u_vig);

    // Grain
    if(u_grain>0.001) c += grain2(uv,u_time)*u_grain*0.06;

    // Clamp + gamma
    c = clamp(c,0.0,1.0);
    c = pow(c, vec3(1.0/2.2));

    gl_FragColor=vec4(c,1.0);
  }
`;

class LaptopGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha:false, preserveDrawingBuffer:true });
    if (!this.gl) { console.error('WebGL not available'); return; }
    this._init();
    this.activeLUT = null;
    this.time = 0;
    // Manual overrides
    this.exposure=0; this.satAdj=1; this.conAdj=1;
    this.liftAdj=0; this.gainAdj=100;
    this.tempAdj=0; this.halationAdj=0.2;
    this.grainAdj=0.3; this.vigAdj=0.7;
    this.chromAb=0;
  }

  _init(){
    const gl=this.gl;
    const mkShader=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; };
    const prog=gl.createProgram();
    gl.attachShader(prog,mkShader(gl.VERTEX_SHADER,VERT));
    gl.attachShader(prog,mkShader(gl.FRAGMENT_SHADER,FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog=prog;

    const quad=new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, 1,1,1,0]);
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    const ap=gl.getAttribLocation(prog,'a_pos');
    const au=gl.getAttribLocation(prog,'a_uv');
    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au,2,gl.FLOAT,false,16,8);

    this.tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);

    const unames=['u_tex','u_mat','u_lift','u_gamma','u_gain','u_stint','u_htint',
      'u_sstr','u_hstr','u_haln','u_fbase','u_sat','u_con','u_temp',
      'u_exp','u_satAdj','u_conAdj','u_liftAdj','u_gainAdj',
      'u_vig','u_grain','u_time','u_chrab'];
    this.u={};
    unames.forEach(n=>this.u[n]=gl.getUniformLocation(prog,n));
    gl.uniform1i(this.u['u_tex'],0);
  }

  // Upload JPEG from phone and render with current LUT
  renderJpeg(img) {
    const gl=this.gl;
    this.time+=0.016;

    // Resize canvas to match image
    if(this.canvas.width!==img.naturalWidth||this.canvas.height!==img.naturalHeight){
      this.canvas.width  = img.naturalWidth  || this.canvas.offsetWidth;
      this.canvas.height = img.naturalHeight || this.canvas.offsetHeight;
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
    }

    gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);

    const lut = this.activeLUT;
    if(!lut){ gl.drawArrays(gl.TRIANGLE_STRIP,0,4); return; }

    const m=lut.matrix;
    gl.uniformMatrix3fv(this.u['u_mat'],false,[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]]);
    gl.uniform3fv(this.u['u_lift'],  lut.lift);
    gl.uniform3fv(this.u['u_gamma'], lut.gamma);
    gl.uniform3fv(this.u['u_gain'],  lut.gain);
    gl.uniform3fv(this.u['u_stint'], lut.shadowTint);
    gl.uniform3fv(this.u['u_htint'], lut.highlightTint);
    gl.uniform1f(this.u['u_sstr'],   lut.shadowStr);
    gl.uniform1f(this.u['u_hstr'],   lut.highlightStr);
    gl.uniform1f(this.u['u_haln'],   lut.halation  * this.halationAdj);
    gl.uniform1f(this.u['u_fbase'],  lut.filmBase);
    gl.uniform1f(this.u['u_sat'],    lut.saturation);
    gl.uniform1f(this.u['u_con'],    lut.contrast);
    gl.uniform1f(this.u['u_temp'],   lut.tempShift + this.tempAdj*0.01);
    gl.uniform1f(this.u['u_exp'],    this.exposure);
    gl.uniform1f(this.u['u_satAdj'],  this.satAdj);
    gl.uniform1f(this.u['u_conAdj'],  this.conAdj);
    gl.uniform1f(this.u['u_liftAdj'], this.liftAdj);
    gl.uniform1f(this.u['u_gainAdj'], this.gainAdj);
    gl.uniform1f(this.u['u_vig'],    this.vigAdj);
    gl.uniform1f(this.u['u_grain'],  this.grainAdj);
    gl.uniform1f(this.u['u_time'],   this.time);
    gl.uniform1f(this.u['u_chrab'],  this.chromAb);

    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }

  setLUT(lut){ this.activeLUT=lut; }
}

window.LaptopGL=LaptopGL;
