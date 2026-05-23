// ═══════════════════════════════════════════════════════════════
//  CINEML PRO — LUT DEFINITIONS  (luts.js)
//
//  Each LUT uses:
//  - 3x3 color matrix (film-emulation color science)
//  - S-curve lift/gamma/gain (controls shadows/mids/highlights)
//  - Split toning (shadow color, highlight color)
//  - Halation   (red/orange bloom in bright areas — film look)
//  - Film base  (lifted blacks — cinema look)
//  - Saturation, contrast, temperature shift
//
//  These mimic:  ARRI LogC, Kodak 2383, Fuji 3510, Bleach Bypass
//  All math happens inside the WebGL fragment shader
// ═══════════════════════════════════════════════════════════════

window.LUTS = [

  // ── 1. FLAT LOG  (log-like flat profile for grading)
  {
    id: 'flat',
    name: 'FLAT',
    grade: 'LOG PROFILE',
    bg: 'linear-gradient(135deg,#2a2a2a,#1a1a1a)',
    // Color matrix (identity — no shift)
    matrix: [1,0,0, 0,1,0, 0,0,1],
    // Lift / Gamma / Gain  (shadows / mids / highlights)
    lift:  [0.08, 0.08, 0.08],
    gamma: [1.0,  1.0,  1.0],
    gain:  [0.88, 0.88, 0.88],
    // Split toning
    shadowTint:    [0,0,0],
    highlightTint: [0,0,0],
    shadowStr:     0.0,
    highlightStr:  0.0,
    // Film properties
    halation:  0.0,
    filmBase:  0.06,
    saturation: 0.6,
    contrast:   0.85,
    tempShift:  0.0,
  },

  // ── 2. ARRI ALEXA  (warm, creamy, organic — industry standard)
  {
    id: 'arri',
    name: 'ALEXA',
    grade: 'ARRI-INSPIRED',
    bg: 'linear-gradient(135deg,#2d1f0a,#1a1408)',
    matrix: [
      1.08,  0.02, -0.05,
     -0.02,  0.98,  0.04,
     -0.04,  0.06,  0.92
    ],
    lift:  [0.04, 0.035, 0.02],
    gamma: [1.05, 1.02,  0.96],
    gain:  [1.04, 1.01,  0.94],
    shadowTint:    [0.12, 0.06, 0.0],
    highlightTint: [1.0, 0.85, 0.5],
    shadowStr:     0.08,
    highlightStr:  0.06,
    halation:  0.18,
    filmBase:  0.05,
    saturation: 1.12,
    contrast:   1.08,
    tempShift:  0.025,
  },

  // ── 3. KODAK 2383  (warm print stock — most used in Hollywood)
  {
    id: 'kodak',
    name: 'KODAK',
    grade: '2383 PRINT',
    bg: 'linear-gradient(135deg,#2a1800,#1a1000)',
    matrix: [
      1.12,  0.04, -0.06,
      0.00,  0.96,  0.04,
     -0.06,  0.08,  0.88
    ],
    lift:  [0.055, 0.04, 0.02],
    gamma: [1.08, 1.02, 0.94],
    gain:  [1.10, 1.00, 0.86],
    shadowTint:    [0.2,  0.08, 0.0],
    highlightTint: [1.0,  0.90, 0.6],
    shadowStr:     0.12,
    highlightStr:  0.08,
    halation:  0.28,
    filmBase:  0.06,
    saturation: 1.18,
    contrast:   1.12,
    tempShift:  0.04,
  },

  // ── 4. FUJI 3510  (cooler, slightly cyan-green — vibrant)
  {
    id: 'fuji',
    name: 'FUJI',
    grade: '3510 VIVID',
    bg: 'linear-gradient(135deg,#0a1520,#050e14)',
    matrix: [
      0.94,  0.04,  0.02,
      0.02,  1.02,  0.06,
     -0.02,  0.12,  1.00
    ],
    lift:  [0.02, 0.03, 0.04],
    gamma: [0.97, 1.01, 1.05],
    gain:  [0.94, 1.00, 1.08],
    shadowTint:    [0.0, 0.05, 0.12],
    highlightTint: [0.8, 0.90, 1.00],
    shadowStr:     0.10,
    highlightStr:  0.05,
    halation:  0.10,
    filmBase:  0.04,
    saturation: 1.10,
    contrast:   1.10,
    tempShift:  -0.02,
  },

  // ── 5. TEAL & ORANGE  (modern blockbuster — most popular Hollywood look)
  {
    id: 'teal',
    name: 'TEAL/ORG',
    grade: 'BLOCKBUSTER',
    bg: 'linear-gradient(135deg,#001a1f,#0d0800)',
    matrix: [
      1.10,  0.00, -0.10,
     -0.04,  0.96,  0.08,
      0.04,  0.14,  1.04
    ],
    lift:  [0.01, 0.03, 0.05],
    gamma: [1.04, 0.99, 0.96],
    gain:  [1.08, 0.98, 0.86],
    shadowTint:    [0.0,  0.18, 0.25],
    highlightTint: [1.0,  0.65, 0.20],
    shadowStr:     0.18,
    highlightStr:  0.14,
    halation:  0.14,
    filmBase:  0.03,
    saturation: 1.05,
    contrast:   1.14,
    tempShift:  0.01,
  },

  // ── 6. BLEACH BYPASS  (desaturated, high contrast — gritty cinema)
  {
    id: 'bleach',
    name: 'BLEACH',
    grade: 'BYPASS',
    bg: 'linear-gradient(135deg,#141414,#080808)',
    matrix: [
      0.85,  0.10,  0.05,
      0.05,  0.85,  0.10,
      0.10,  0.05,  0.85
    ],
    lift:  [0.0, 0.0, 0.0],
    gamma: [1.0, 1.0, 1.0],
    gain:  [1.0, 1.0, 1.0],
    shadowTint:    [0,0,0],
    highlightTint: [1,1,1],
    shadowStr:     0.0,
    highlightStr:  0.0,
    halation:  0.0,
    filmBase:  0.0,
    saturation: 0.12,
    contrast:   1.45,
    tempShift:  0.0,
  },

  // ── 7. GOLDEN HOUR  (warm sunset — romantic/epic)
  {
    id: 'golden',
    name: 'GOLDEN',
    grade: 'HOUR',
    bg: 'linear-gradient(135deg,#2a1400,#1a0c00)',
    matrix: [
      1.18,  0.06, -0.04,
      0.02,  0.98,  0.00,
     -0.08,  0.02,  0.78
    ],
    lift:  [0.07, 0.04, 0.01],
    gamma: [1.10, 1.03, 0.88],
    gain:  [1.18, 1.04, 0.70],
    shadowTint:    [0.25, 0.10, 0.0],
    highlightTint: [1.0,  0.80, 0.3],
    shadowStr:     0.14,
    highlightStr:  0.12,
    halation:  0.40,
    filmBase:  0.06,
    saturation: 1.22,
    contrast:   1.10,
    tempShift:  0.06,
  },

  // ── 8. MOONLIGHT  (cool blue-cyan — night/mysterious)
  {
    id: 'moon',
    name: 'MOON',
    grade: 'NIGHT',
    bg: 'linear-gradient(135deg,#00101a,#000810)',
    matrix: [
      0.78,  0.04,  0.08,
      0.04,  0.90,  0.10,
      0.08,  0.18,  1.18
    ],
    lift:  [0.01, 0.02, 0.05],
    gamma: [0.90, 0.96, 1.08],
    gain:  [0.76, 0.90, 1.20],
    shadowTint:    [0.0,  0.05, 0.18],
    highlightTint: [0.6,  0.80, 1.00],
    shadowStr:     0.16,
    highlightStr:  0.10,
    halation:  0.06,
    filmBase:  0.04,
    saturation: 0.80,
    contrast:   1.18,
    tempShift:  -0.05,
  },

  // ── 9. CROSS PROCESS  (pushed film — acid/fashion/editorial)
  {
    id: 'xpro',
    name: 'X-PRO',
    grade: 'CROSS PROCESS',
    bg: 'linear-gradient(135deg,#0a1a00,#100010)',
    matrix: [
      1.10, -0.05,  0.10,
      0.10,  1.10, -0.05,
     -0.05,  0.10,  1.10
    ],
    lift:  [0.04, 0.00, 0.06],
    gamma: [1.08, 0.92, 1.10],
    gain:  [1.14, 0.88, 1.18],
    shadowTint:    [0.10, 0.0,  0.18],
    highlightTint: [0.90, 1.0,  0.20],
    shadowStr:     0.14,
    highlightStr:  0.12,
    halation:  0.08,
    filmBase:  0.05,
    saturation: 1.30,
    contrast:   1.20,
    tempShift:  0.02,
  },

  // ── 10. INFRARED  (dreamy surreal — foliage white, skies dark)
  {
    id: 'ir',
    name: 'INFRA',
    grade: 'RED',
    bg: 'linear-gradient(135deg,#200008,#100005)',
    matrix: [
      1.20, -0.10, -0.10,
     -0.30,  0.80,  0.50,
     -0.20,  0.10,  1.00
    ],
    lift:  [0.06, 0.02, 0.02],
    gamma: [1.15, 0.88, 0.90],
    gain:  [1.30, 0.82, 0.80],
    shadowTint:    [0.20, 0.0, 0.05],
    highlightTint: [1.00, 0.9, 0.90],
    shadowStr:     0.16,
    highlightStr:  0.08,
    halation:  0.22,
    filmBase:  0.05,
    saturation: 0.55,
    contrast:   1.28,
    tempShift:  0.08,
  },
];
