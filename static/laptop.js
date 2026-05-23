// laptop.js — CineML Pro Laptop Controller

const WS_PORT = 8444;

let gl = null;
let ws = null;
let wsReady = false;
let autoLut = true;
let isRecording = false;
let recSecs = 0, recClock = null;
let frameCount = 0, lastFpsTime = performance.now();
let tools = { grid:true, scope:true, peak:false, zebra:false, vig:true, flare:false, rays:false, border:true };
let recChunks = [], mediaRec = null;
let lastFrame = null; // latest Image from phone

const ASPECTS = [
  {label:'16:9',top:0,bot:0},
  {label:'2.39:1',top:13.5,bot:13.5},
  {label:'1.85:1',top:7,bot:7},
  {label:'4:3',top:0,bot:0},
  {label:'1:1',top:12,bot:12},
];

// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════
async function boot() {
  const fill = document.getElementById('bootFill');
  const step = document.getElementById('bootStep');
  const go = async (pct, msg, fn) => {
    fill.style.width = pct + '%';
    step.textContent = msg;
    if (fn) await fn();
    await delay(400);
  };

  await go(15,  'INITIALIZING WEBGL ENGINE...', () => {
    const canvas = document.getElementById('previewCanvas');
    gl = new LaptopGL(canvas);
    document.getElementById('sbWGLText').textContent = 'WEBGL: GPU ACTIVE';
    document.getElementById('sbWGL').classList.add('green');
  });

  await go(35,  'BUILDING LUT LIBRARY...', buildLUTs);
  await go(55,  'CONNECTING TO ML SERVER...', connectWS);
  await go(75,  'CONFIGURING MONITOR TOOLS...');
  await go(90,  'STARTING RENDER ENGINE...', () => { renderLoop(); clockLoop(); });
  await go(100, 'SYSTEM READY');

  await delay(800);
  const b = document.getElementById('boot');
  b.style.transition = 'opacity 0.8s';
  b.style.opacity = '0';
  setTimeout(() => b.style.display = 'none', 850);
}

// ══════════════════════════════════════════════
//  WEBSOCKET — receives frames from phone
// ══════════════════════════════════════════════
async function connectWS() {
  let url;
  try {
    const r = await fetch('/ws_url.txt');
    if (r.ok) { const u = (await r.text()).trim(); if (u.startsWith('wss://')) { url = u; } }
  } catch(e){}
  if (!url) url = `wss://${location.hostname}:${WS_PORT}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    wsReady = true;
    setConnStatus(true);
    ws.send(JSON.stringify({ type: 'register', role: 'laptop' }));
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'grade') handleGrade(data);
    if (data.type === 'frame_ack') {} // phone frame confirmed
  };

  ws.onclose = () => {
    wsReady = false;
    setConnStatus(false);
    setTimeout(connectWS, 3000);
  };
}

function setConnStatus(ok) {
  const tb = document.getElementById('tbConn');
  const sb = document.getElementById('sbPhone');
  const st = document.getElementById('sbPhoneText');
  if (ok) {
    tb.textContent = '● PHONE CONNECTED';
    tb.classList.add('active');
    sb.classList.add('green');
    st.textContent = 'PHONE: CONNECTED';
  } else {
    tb.textContent = '● WAITING FOR PHONE';
    tb.classList.remove('active');
    sb.classList.remove('green');
    st.textContent = 'PHONE: OFFLINE';
    document.getElementById('hScene').textContent = '◆ NO SIGNAL';
    document.getElementById('monInfo').textContent = 'WAITING FOR CAMERA...';
  }
}

// ══════════════════════════════════════════════
//  HANDLE GRADE FROM PYTHON ML
// ══════════════════════════════════════════════
function handleGrade(data) {
  // Update ML status
  document.getElementById('mlDot').className = 'ml-dot ok';
  document.getElementById('mlText').textContent = 'ML inference active';
  document.getElementById('mlVersion').textContent = 'ONLINE';
  document.getElementById('tbML').textContent = 'ML: ACTIVE';
  document.getElementById('sbML').classList.add('green');
  document.getElementById('sbMLText').textContent = 'ML: RUNNING';

  // Scene info
  const sceneName = (data.scene || '').replace(/_/g,' ').toUpperCase();
  document.getElementById('hScene').textContent   = '◆ ' + sceneName;
  document.getElementById('sceneName').textContent = sceneName;
  document.getElementById('sceneMeta').textContent = data.meta || '';
  document.getElementById('sceneConf').textContent = ((data.confidence||0)*100).toFixed(0) + '% CONFIDENCE';
  document.getElementById('hConf').textContent     = ((data.confidence||0)*100).toFixed(0) + '% CONF';

  // Readouts
  if (data.features) {
    const f = data.features;
    const ev = ((f.brightness - 50) / 50 * 2).toFixed(1);
    document.getElementById('rExp').textContent  = (ev >= 0 ? '+' : '') + ev + ' EV';
    document.getElementById('rTemp').textContent = f.temperature + 'K';
    document.getElementById('rHi').textContent   = f.brightness > 80 ? '⚠ HIGH' : 'OK';
    document.getElementById('rSh').textContent   = f.brightness < 20 ? 'CRUSHED' : 'OK';
  }

  // Auto-apply LUT
  if (autoLut && data.lut) {
    const lut = serverLutToLocal(data.lut);
    gl.setLUT(lut);
    document.getElementById('hLut').textContent = 'LUT: ' + (data.lut.name || '—');
    document.getElementById('tbML').textContent = 'ML: ' + (data.lut.name || '—');
    highlightActiveLUT(data.lut.id);

    // Apply ML auto-exposure suggestion
    if (data.adjustments && data.adjustments.autoExposure !== undefined && autoLut) {
      const ev = Math.max(-1.5, Math.min(1.5, data.adjustments.autoExposure * 0.4));
      gl.exposure = ev;
      document.getElementById('slExp').value = ev * 50;
      document.getElementById('vExp').textContent = (ev >= 0 ? '+' : '') + ev.toFixed(1);
    }
  }

  // Render the frame if we have one
  if (data.frame) renderPhoneFrame(data.frame);
}

function serverLutToLocal(s) {
  // Try to find matching local LUT first
  const local = window.LUTS.find(l => l.id === s.id);
  if (local) return local;
  // Otherwise build from server data
  return {
    id: s.id, name: s.name,
    matrix: s.matrix, lift: s.lift, gamma: s.gamma, gain: s.gain,
    shadowTint: s.shadowTint, highlightTint: s.highlightTint,
    shadowStr: s.shadowStr, highlightStr: s.highlightStr,
    halation: s.halation, filmBase: s.filmBase,
    saturation: s.saturation, contrast: s.contrast, tempShift: s.tempShift,
  };
}

// ══════════════════════════════════════════════
//  RENDER PHONE FRAME on laptop canvas
// ══════════════════════════════════════════════
function renderPhoneFrame(b64jpeg) {
  const img = new Image();
  img.onload = () => {
    lastFrame = img;
    gl.renderJpeg(img);
    frameCount++;

    // Scopes
    if (tools.scope) drawScopes(img);
    if (tools.peak)  drawFocusPeaking(img);
    if (tools.zebra) drawZebra(img);

    // FPS
    const now = performance.now();
    if (now - lastFpsTime > 1000) {
      const f = Math.round(frameCount * 1000 / (now - lastFpsTime));
      document.getElementById('tbFPS').textContent  = f + ' FPS';
      document.getElementById('sbFps').textContent  = f + ' FPS';
      frameCount = 0;
      lastFpsTime = now;
    }

    document.getElementById('sbRes').textContent  = img.naturalWidth + ' × ' + img.naturalHeight;
    document.getElementById('monRes').textContent = img.naturalWidth + ' × ' + img.naturalHeight;
    document.getElementById('monInfo').textContent = 'LIVE · ' + (gl.activeLUT ? gl.activeLUT.name : 'NO LUT');
  };
  img.src = 'data:image/jpeg;base64,' + b64jpeg;
}

// ══════════════════════════════════════════════
//  RENDER LOOP (re-render last frame with updated grades)
// ══════════════════════════════════════════════
function renderLoop() {
  if (lastFrame && gl) gl.renderJpeg(lastFrame);
  requestAnimationFrame(renderLoop);
}

// ══════════════════════════════════════════════
//  SCOPES
// ══════════════════════════════════════════════
function drawScopes(img) {
  const sc = document.createElement('canvas');
  sc.width=64; sc.height=36;
  const sx = sc.getContext('2d');
  sx.drawImage(img,0,0,64,36);
  const d = sx.getImageData(0,0,64,36).data;

  // Histogram
  const hc = document.getElementById('histCanvas');
  const hx = hc.getContext('2d');
  const rb=new Array(32).fill(0), gb=new Array(32).fill(0), bb=new Array(32).fill(0);
  for(let i=0;i<d.length;i+=4){
    rb[Math.min(31,d[i]>>3)]++;
    gb[Math.min(31,d[i+1]>>3)]++;
    bb[Math.min(31,d[i+2]>>3)]++;
  }
  const mx=Math.max(...rb,...gb,...bb,1);
  hx.fillStyle='rgba(0,0,0,0.7)'; hx.fillRect(0,0,100,54);
  [[rb,'rgba(255,50,50,0.7)'],[gb,'rgba(50,220,50,0.7)'],[bb,'rgba(50,100,255,0.7)']].forEach(([bins,col])=>{
    hx.fillStyle=col;
    bins.forEach((v,x)=>{ const h=(v/mx)*52; hx.fillRect(x*3,54-h,2,h); });
  });

  // Waveform
  const wc = document.getElementById('waveCanvas');
  const wx = wc.getContext('2d');
  wx.fillStyle='rgba(0,0,0,0.7)'; wx.fillRect(0,0,100,54);
  for(let x=0;x<64;x++){
    for(let y=0;y<36;y++){
      const i=(y*64+x)*4;
      const lum=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
      const py=54-(lum/255)*54;
      wx.fillStyle='rgba(80,220,100,0.25)';
      wx.fillRect(x*1.56,py,1,1);
    }
  }
  // IRE lines
  wx.strokeStyle='rgba(255,255,255,0.1)'; wx.lineWidth=0.5;
  [0,25,50,75,100].forEach(p=>{ const y=54-(p/100)*54; wx.beginPath(); wx.moveTo(0,y); wx.lineTo(100,y); wx.stroke(); });

  // Vectorscope
  const vc = document.getElementById('vectorCanvas');
  const vx = vc.getContext('2d');
  vx.fillStyle='rgba(0,0,0,0.7)'; vx.fillRect(0,0,54,54);
  vx.strokeStyle='rgba(255,255,255,0.06)'; vx.lineWidth=0.5;
  vx.beginPath(); vx.arc(27,27,24,0,Math.PI*2); vx.stroke();
  for(let i=0;i<d.length;i+=16){
    const r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
    const cb=-0.169*r-0.331*g+0.5*b;
    const cr=0.5*r-0.419*g-0.081*b;
    const px=27+cb*48, py=27+cr*48;
    vx.fillStyle='rgba(100,255,150,0.4)';
    vx.fillRect(px,py,1,1);
  }
}

function drawFocusPeaking(img) {
  const pc = document.getElementById('peakCanvas');
  if (pc.width !== gl.canvas.width) { pc.width=gl.canvas.width; pc.height=gl.canvas.height; }
  const px = pc.getContext('2d');
  px.clearRect(0,0,pc.width,pc.height);
  // Simplified edge detection overlay
  const sc=document.createElement('canvas'); sc.width=160; sc.height=90;
  const sx=sc.getContext('2d'); sx.drawImage(img,0,0,160,90);
  const d=sx.getImageData(0,0,160,90).data;
  const out=px.createImageData(pc.width,pc.height);
  for(let y=1;y<90-1;y++) for(let x=1;x<159;x++){
    const i=(y*160+x)*4;
    const lum=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    const r=(((y-1)*160+x)*4); const l=(((y+1)*160+x)*4);
    const lumR=(d[r]*77+d[r+1]*150+d[r+2]*29)>>8;
    const lumL=(d[l]*77+d[l+1]*150+d[l+2]*29)>>8;
    const edge=Math.abs(lum-lumR)+Math.abs(lum-lumL);
    if(edge>30){
      const ox=Math.round(x/160*pc.width), oy=Math.round(y/90*pc.height);
      const oi=(oy*pc.width+ox)*4;
      out.data[oi]=255; out.data[oi+1]=60; out.data[oi+2]=60; out.data[oi+3]=200;
    }
  }
  px.putImageData(out,0,0);
}

function drawZebra(img) {
  const zc = document.getElementById('zebraCanvas');
  if (zc.width !== gl.canvas.width) { zc.width=gl.canvas.width; zc.height=gl.canvas.height; }
  const zx = zc.getContext('2d');
  zx.clearRect(0,0,zc.width,zc.height);
  const sc=document.createElement('canvas'); sc.width=160; sc.height=90;
  const sx=sc.getContext('2d'); sx.drawImage(img,0,0,160,90);
  const d=sx.getImageData(0,0,160,90).data;
  for(let y=0;y<90;y++) for(let x=0;x<160;x++){
    const i=(y*160+x)*4;
    const lum=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;
    if(lum>220){
      const ox=Math.round(x/160*zc.width), oy=Math.round(y/90*zc.height);
      const stripe=(ox+oy)%16<8;
      if(stripe){ zx.fillStyle='rgba(255,200,0,0.7)'; zx.fillRect(ox,oy,4,4); }
    }
  }
}

// ══════════════════════════════════════════════
//  LUT GRID
// ══════════════════════════════════════════════
const LUT_SWATCHES = {
  flat:   'linear-gradient(135deg,#2a2a2a,#1a1a1a)',
  arri:   'linear-gradient(135deg,#3d2a10,#1a1205)',
  kodak:  'linear-gradient(135deg,#3a1c00,#1e0e00)',
  fuji:   'linear-gradient(135deg,#0a1828,#040e18)',
  teal:   'linear-gradient(135deg,#001820,#0d0800)',
  bleach: 'linear-gradient(135deg,#181818,#080808)',
  golden: 'linear-gradient(135deg,#2a1400,#1a0c00)',
  moon:   'linear-gradient(135deg,#000e1a,#000610)',
  xpro:   'linear-gradient(135deg,#0a1a00,#100010)',
  ir:     'linear-gradient(135deg,#200008,#100005)',
};

function buildLUTs() {
  const grid = document.getElementById('lutGrid');
  window.LUTS.forEach((lut, i) => {
    const card = document.createElement('div');
    card.className = 'lut-card' + (i===0?' active':'');
    card.dataset.id = lut.id;
    card.innerHTML = `
      <div class="lut-card-swatch" style="background:${LUT_SWATCHES[lut.id]||'#111'}"></div>
      <div class="lut-card-name">${lut.name}</div>
      <div class="lut-card-grade">${lut.grade}</div>
    `;
    card.onclick = () => {
      autoLut = false;
      document.getElementById('btnAutoLut').classList.remove('active');
      document.getElementById('autoLutLabel').textContent = 'MANUAL';
      gl.setLUT(lut);
      document.getElementById('hLut').textContent = 'LUT: ' + lut.name;
      highlightActiveLUT(lut.id);
      // Tell phone which LUT is active
      sendToPhone({ type:'lut', id:lut.id, name:lut.name });
    };
    grid.appendChild(card);
  });
}

function highlightActiveLUT(id) {
  document.querySelectorAll('.lut-card').forEach(c => c.classList.toggle('active', c.dataset.id === id));
}

function toggleAutoLut() {
  autoLut = !autoLut;
  document.getElementById('btnAutoLut').classList.toggle('active', autoLut);
  document.getElementById('autoLutLabel').textContent = autoLut ? 'AUTO' : 'MANUAL';
}

function resetGrade() {
  gl.exposure=0; gl.satAdj=1; gl.conAdj=1; gl.liftAdj=0; gl.gainAdj=100;
  gl.tempAdj=0; gl.halationAdj=0.2; gl.grainAdj=0.3;
  ['slExp','slSat','slCon','slTemp','slLift','slGain','slHaln','slGrain'].forEach(id => {
    const el=document.getElementById(id);
    if(el) el.value=el.defaultValue;
  });
  ['vExp','vSat','vCon','vTemp','vLift','vGain','vHaln','vGrain'].forEach((id,i)=>{
    const vals=['0.0','100','100','0','0','100','20','30'];
    const el=document.getElementById(id); if(el) el.textContent=vals[i];
  });
}

// ══════════════════════════════════════════════
//  SLIDERS
// ══════════════════════════════════════════════
function onSlider(el, key) {
  const v = parseFloat(el.value);
  const map = {
    exp:  () => { gl.exposure = v/50*2;    document.getElementById('vExp').textContent  = (v>=0?'+':'')+((v/50)*2).toFixed(1); },
    sat:  () => { gl.satAdj   = v/100;     document.getElementById('vSat').textContent  = v; },
    con:  () => { gl.conAdj   = v/100;     document.getElementById('vCon').textContent  = v; },
    temp: () => { gl.tempAdj  = v;         document.getElementById('vTemp').textContent = v; },
    lift: () => { gl.liftAdj  = v;         document.getElementById('vLift').textContent = v; },
    gain: () => { gl.gainAdj  = v;         document.getElementById('vGain').textContent = v; },
    haln: () => { gl.halationAdj = v/100;  document.getElementById('vHaln').textContent = v; },
    grain:() => { gl.grainAdj = v/100;     document.getElementById('vGrain').textContent = v; },
  };
  if (map[key]) map[key]();
  // Send grade override to phone server
  sendToPhone({ type:'grade_override', key, value: v });
}

// ══════════════════════════════════════════════
//  MONITOR TOOLS
// ══════════════════════════════════════════════
function toggleTool(key) {
  tools[key] = !tools[key];
  document.getElementById('btn'+key.charAt(0).toUpperCase()+key.slice(1)).classList.toggle('active', tools[key]);

  if (key==='grid') {
    document.querySelectorAll('.grid-line,.safe-frame').forEach(el => el.style.display = tools.grid?'':'none');
  }
  if (key==='scope') {
    document.getElementById('scopes').style.display = tools.scope?'flex':'none';
  }
  if (key==='peak')  { document.getElementById('peakCanvas').classList.toggle('on', tools.peak); }
  if (key==='zebra') { document.getElementById('zebraCanvas').classList.toggle('on', tools.zebra); }
  if (key==='vig')   { gl.vigAdj = tools.vig ? 0.7 : 0; }
  if (key==='flare') { sendToPhone({ type:'effect', key:'flare', on:tools.flare }); }
  if (key==='rays')  { sendToPhone({ type:'effect', key:'rays',  on:tools.rays  }); }
  if (key==='border'){ sendToPhone({ type:'effect', key:'border',on:tools.border}); }
}

function setAspect(idx) {
  const a = ASPECTS[idx];
  document.getElementById('lboxTop').style.height = a.top + '%';
  document.getElementById('lboxBot').style.height = a.bot + '%';
  document.querySelectorAll('.btn-row .btn').forEach((b,i) => {
    if (b.onclick && b.onclick.toString().includes('setAspect('+idx+')')) b.classList.add('active');
  });
  sendToPhone({ type:'aspect', index: idx });
}

// ══════════════════════════════════════════════
//  RECORDING (records the laptop preview canvas)
// ══════════════════════════════════════════════
function toggleRecord() {
  isRecording ? stopRecord() : startRecord();
}

function startRecord() {
  isRecording = true; recChunks = []; recSecs = 0;
  const stream = document.getElementById('previewCanvas').captureStream(30);
  const mimes = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
  mediaRec = new MediaRecorder(stream, mime?{mimeType:mime}:{});
  mediaRec.ondataavailable = e => e.data.size && recChunks.push(e.data);
  mediaRec.onstop = saveRecording;
  mediaRec.start(100);
  document.getElementById('btnRec').textContent = '■ STOP RECORDING';
  document.getElementById('btnRec').classList.add('recording');
  document.getElementById('recDot').classList.add('on');
  document.getElementById('recLabel').textContent = 'RECORDING';
  document.getElementById('tbRec').style.display = '';
  sendToPhone({ type:'rec_start' });
  recClock = setInterval(() => {
    recSecs++;
    const h=String(Math.floor(recSecs/3600)).padStart(2,'0');
    const m=String(Math.floor((recSecs%3600)/60)).padStart(2,'0');
    const s=String(recSecs%60).padStart(2,'0');
    document.getElementById('recTimer').textContent = h+':'+m+':'+s;
  }, 1000);
}

function stopRecord() {
  isRecording = false;
  mediaRec.stop(); clearInterval(recClock);
  document.getElementById('btnRec').textContent = '● START RECORDING';
  document.getElementById('btnRec').classList.remove('recording');
  document.getElementById('recDot').classList.remove('on');
  document.getElementById('recLabel').textContent = 'MONITOR';
  document.getElementById('tbRec').style.display = 'none';
  sendToPhone({ type:'rec_stop' });
}

function saveRecording() {
  const blob = new Blob(recChunks, {type:'video/webm'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download='cineml_'+Date.now()+'.webm'; a.click();
  URL.revokeObjectURL(url);
}

function capturePhoto() {
  const a = document.createElement('a');
  a.download = 'cineml_'+Date.now()+'.jpg';
  a.href = document.getElementById('previewCanvas').toDataURL('image/jpeg',0.97);
  a.click();
}

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════
function sendToPhone(data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function clockLoop() {
  setInterval(() => {
    const n=new Date();
    document.getElementById('clock').textContent =
      String(n.getHours()).padStart(2,'0')+':'+
      String(n.getMinutes()).padStart(2,'0')+':'+
      String(n.getSeconds()).padStart(2,'0');
  }, 1000);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener('load', boot);
