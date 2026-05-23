# server.py — CineML Pro v3
# Handles: phone camera → ML inference → laptop display
# Two WebSocket clients: "phone" and "laptop"

import asyncio, websockets, json, base64, ssl, socket
import threading, subprocess, os, sys, time
import numpy as np
from io import BytesIO
from PIL import Image
from http.server import HTTPServer, SimpleHTTPRequestHandler

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

HTTPS_PORT = 8443
WSS_PORT   = 8444

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# ── Connected clients
phone_ws  = None
laptop_ws = None

# ══════════════════════════════════════════════
#  LUT PARAMS
# ══════════════════════════════════════════════
LUT_PARAMS = {
    "golden": {
        "id":"golden","name":"GOLDEN HOUR",
        "matrix":[1.18,0.06,-0.04,0.02,0.98,0.00,-0.08,0.02,0.78],
        "lift":[0.07,0.04,0.01],"gamma":[1.10,1.03,0.88],"gain":[1.18,1.04,0.70],
        "shadowTint":[0.25,0.10,0.00],"highlightTint":[1.00,0.80,0.30],
        "shadowStr":0.14,"highlightStr":0.12,
        "halation":0.40,"filmBase":0.06,"saturation":1.22,"contrast":1.10,"tempShift":0.06,
    },
    "arri": {
        "id":"arri","name":"ARRI ALEXA",
        "matrix":[1.08,0.02,-0.05,-0.02,0.98,0.04,-0.04,0.06,0.92],
        "lift":[0.04,0.035,0.02],"gamma":[1.05,1.02,0.96],"gain":[1.04,1.01,0.94],
        "shadowTint":[0.12,0.06,0.00],"highlightTint":[1.00,0.85,0.50],
        "shadowStr":0.08,"highlightStr":0.06,
        "halation":0.18,"filmBase":0.05,"saturation":1.12,"contrast":1.08,"tempShift":0.025,
    },
    "kodak": {
        "id":"kodak","name":"KODAK 2383",
        "matrix":[1.12,0.04,-0.06,0.00,0.96,0.04,-0.06,0.08,0.88],
        "lift":[0.055,0.04,0.02],"gamma":[1.08,1.02,0.94],"gain":[1.10,1.00,0.86],
        "shadowTint":[0.20,0.08,0.00],"highlightTint":[1.00,0.90,0.60],
        "shadowStr":0.12,"highlightStr":0.08,
        "halation":0.28,"filmBase":0.06,"saturation":1.18,"contrast":1.12,"tempShift":0.04,
    },
    "fuji": {
        "id":"fuji","name":"FUJI 3510",
        "matrix":[0.94,0.04,0.02,0.02,1.02,0.06,-0.02,0.12,1.00],
        "lift":[0.02,0.03,0.04],"gamma":[0.97,1.01,1.05],"gain":[0.94,1.00,1.08],
        "shadowTint":[0.00,0.05,0.12],"highlightTint":[0.80,0.90,1.00],
        "shadowStr":0.10,"highlightStr":0.05,
        "halation":0.10,"filmBase":0.04,"saturation":1.10,"contrast":1.10,"tempShift":-0.02,
    },
    "moon": {
        "id":"moon","name":"MOONLIGHT",
        "matrix":[0.78,0.04,0.08,0.04,0.90,0.10,0.08,0.18,1.18],
        "lift":[0.01,0.02,0.05],"gamma":[0.90,0.96,1.08],"gain":[0.76,0.90,1.20],
        "shadowTint":[0.00,0.05,0.18],"highlightTint":[0.60,0.80,1.00],
        "shadowStr":0.16,"highlightStr":0.10,
        "halation":0.06,"filmBase":0.04,"saturation":0.80,"contrast":1.18,"tempShift":-0.05,
    },
    "bleach": {
        "id":"bleach","name":"BLEACH BYPASS",
        "matrix":[0.85,0.10,0.05,0.05,0.85,0.10,0.10,0.05,0.85],
        "lift":[0,0,0],"gamma":[1,1,1],"gain":[1,1,1],
        "shadowTint":[0,0,0],"highlightTint":[1,1,1],
        "shadowStr":0,"highlightStr":0,
        "halation":0,"filmBase":0,"saturation":0.12,"contrast":1.45,"tempShift":0,
    },
    "teal": {
        "id":"teal","name":"TEAL & ORANGE",
        "matrix":[1.10,0.00,-0.10,-0.04,0.96,0.08,0.04,0.14,1.04],
        "lift":[0.01,0.03,0.05],"gamma":[1.04,0.99,0.96],"gain":[1.08,0.98,0.86],
        "shadowTint":[0.00,0.18,0.25],"highlightTint":[1.00,0.65,0.20],
        "shadowStr":0.18,"highlightStr":0.14,
        "halation":0.14,"filmBase":0.03,"saturation":1.05,"contrast":1.14,"tempShift":0.01,
    },
    "xpro": {
        "id":"xpro","name":"CROSS PROCESS",
        "matrix":[1.10,-0.05,0.10,0.10,1.10,-0.05,-0.05,0.10,1.10],
        "lift":[0.04,0.00,0.06],"gamma":[1.08,0.92,1.10],"gain":[1.14,0.88,1.18],
        "shadowTint":[0.10,0.00,0.18],"highlightTint":[0.90,1.00,0.20],
        "shadowStr":0.14,"highlightStr":0.12,
        "halation":0.08,"filmBase":0.05,"saturation":1.30,"contrast":1.20,"tempShift":0.02,
    },
    "flat": {
        "id":"flat","name":"FLAT LOG",
        "matrix":[1,0,0,0,1,0,0,0,1],
        "lift":[0.08,0.08,0.08],"gamma":[1,1,1],"gain":[0.88,0.88,0.88],
        "shadowTint":[0,0,0],"highlightTint":[0,0,0],
        "shadowStr":0,"highlightStr":0,
        "halation":0,"filmBase":0.06,"saturation":0.6,"contrast":0.85,"tempShift":0,
    },
    "ir": {
        "id":"ir","name":"INFRARED",
        "matrix":[1.20,-0.10,-0.10,-0.30,0.80,0.50,-0.20,0.10,1.00],
        "lift":[0.06,0.02,0.02],"gamma":[1.15,0.88,0.90],"gain":[1.30,0.82,0.80],
        "shadowTint":[0.20,0.00,0.05],"highlightTint":[1.00,0.90,0.90],
        "shadowStr":0.16,"highlightStr":0.08,
        "halation":0.22,"filmBase":0.05,"saturation":0.55,"contrast":1.28,"tempShift":0.08,
    },
}

SCENE_LUT_MAP = {
    "golden_hour":"golden","sunset":"kodak","outdoor_day":"arri",
    "overcast":"fuji","blue_hour":"moon","night":"bleach",
    "interior_warm":"kodak","interior_cool":"fuji","portrait":"arri","high_contrast":"teal",
}
SCENE_META = {
    "golden_hour":"Magic hour · warm tones · KODAK 2383",
    "sunset":"Sunset · print stock active",
    "outdoor_day":"Outdoor day · organic ARRI grade",
    "overcast":"Flat light · FUJI vivid processing",
    "blue_hour":"Blue hour · moonlight mode",
    "night":"Low light · bleach bypass contrast",
    "interior_warm":"Tungsten interior · warm grade",
    "interior_cool":"Daylight interior · crisp tone",
    "portrait":"Skin detected · ARRI portrait grade",
    "high_contrast":"High contrast · teal orange split",
}

# ══════════════════════════════════════════════
#  ML
# ══════════════════════════════════════════════
model = None
label_map = None
last_inference_time = 0
INFERENCE_INTERVAL = 1.5  # seconds

def load_model():
    global model, label_map
    if not os.path.exists("scene_model.h5"):
        print("  ! No scene_model.h5 — using rule-based fallback")
        print("    Run: python train_model.py")
        return False
    try:
        import tensorflow as tf
        model = tf.keras.models.load_model("scene_model.h5")
        with open("label_map.json") as f:
            label_map = json.load(f)
        print("  OK ML model: " + str(model.count_params()) + " parameters")
        return True
    except Exception as e:
        print("  ! Model load error: " + str(e))
        return False

def extract_features(arr):
    img = Image.fromarray(arr).resize((8,8))
    a   = np.array(img, dtype=np.float32)
    r,g,b = a[:,:,0],a[:,:,1],a[:,:,2]
    avg_r=r.mean()/255; avg_g=g.mean()/255; avg_b=b.mean()/255
    luma=(0.299*r+0.587*g+0.114*b)
    bright=luma.mean()/255
    temp=((r.mean()-b.mean())/(g.mean()+1)+1)/2
    ln=luma/255
    dark_r=float((ln<0.25).mean())
    brt_r=float((ln>0.75).mean())
    rn,gn,bn=r/255,g/255,b/255
    sat=float(np.sqrt((rn-gn)**2+(gn-bn)**2+(rn-bn)**2).mean()/1.414)
    con=float(ln.std())
    return np.array([avg_r,avg_g,avg_b,bright,temp,con,dark_r,brt_r,sat],dtype=np.float32)

def rule_based(f):
    avg_r,avg_g,avg_b,bright,temp_n,con,dark_r,brt_r,sat=f
    t=temp_n*2-1
    if sat>0.35 and bright>0.65 and t>0.25: return "golden_hour"
    if sat>0.25 and bright>0.50 and t>0.12: return "sunset"
    if bright>0.60 and t<-0.05:             return "overcast"
    if bright>0.55:                         return "outdoor_day"
    if bright<0.18:                         return "night"
    if bright<0.35 and t<-0.03:            return "blue_hour"
    if con>0.30:                            return "high_contrast"
    if t>0.08:                              return "interior_warm"
    return "interior_cool"

def classify(img_array):
    features = extract_features(img_array)
    if model:
        probs=model.predict(features.reshape(1,9),verbose=0)[0]
        idx=int(np.argmax(probs)); conf=float(probs[idx])
        scene=label_map[str(idx)]["scene"]
    else:
        scene=rule_based(features); conf=0.85

    lut = LUT_PARAMS[SCENE_LUT_MAP.get(scene,"arri")]
    br  = float(features[3])
    tmp = float(features[4])*2-1
    return {
        "scene":      scene,
        "confidence": round(conf,3),
        "meta":       SCENE_META.get(scene,""),
        "lut":        lut,
        "adjustments":{"autoExposure":round((0.5-br)*1.2,3)},
        "features":{
            "brightness":  round(br*100,1),
            "temperature": round(tmp*3000+6500,0),
            "contrast":    round(float(features[5])*100,1),
            "saturation":  round(float(features[8])*100,1),
        }
    }

# ══════════════════════════════════════════════
#  WEBSOCKET HANDLER
# ══════════════════════════════════════════════
async def ws_handler(websocket):
    global phone_ws, laptop_ws, last_inference_time
    role = None

    try:
        async for raw in websocket:
            try:
                data = json.loads(raw)
                msg_type = data.get("type","")

                # ── Registration
                if msg_type == "register":
                    role = data.get("role","phone")
                    if role == "laptop":
                        laptop_ws = websocket
                        print("  LAPTOP connected: " + str(websocket.remote_address[0]))
                    else:
                        phone_ws = websocket
                        print("  PHONE  connected: " + str(websocket.remote_address[0]))
                    continue

                # ── Phone sends camera frame
                if msg_type == "frame":
                    if role is None: role = "phone"; phone_ws = websocket

                    now = time.time()
                    should_infer = (now - last_inference_time) >= INFERENCE_INTERVAL

                    # Decode JPEG
                    jpg = base64.b64decode(data["jpeg"])
                    img = Image.open(BytesIO(jpg)).convert("RGB")
                    arr = np.array(img, dtype=np.uint8)

                    result = None
                    if should_infer:
                        last_inference_time = now
                        result = classify(arr)

                    # Forward frame to laptop with grade info
                    if laptop_ws:
                        payload = {
                            "type":  "grade",
                            "frame": data["jpeg"],  # raw frame for laptop display
                        }
                        if result:
                            payload.update(result)
                        try:
                            await laptop_ws.send(json.dumps(payload))
                        except Exception:
                            laptop_ws = None

                    continue

                # ── Laptop sends control commands → forward to phone
                if role == "laptop" or laptop_ws == websocket:
                    if phone_ws:
                        try:
                            await phone_ws.send(raw)
                        except Exception:
                            phone_ws = None
                    continue

                # ── Ping
                if msg_type == "ping":
                    await websocket.send(json.dumps({"type":"pong"}))

            except Exception as e:
                print("  Handler error: " + str(e))

    except Exception:
        pass
    finally:
        if websocket == phone_ws:
            phone_ws = None
            print("  PHONE  disconnected")
            if laptop_ws:
                try: await laptop_ws.send(json.dumps({"type":"phone_disconnected"}))
                except: pass
        if websocket == laptop_ws:
            laptop_ws = None
            print("  LAPTOP disconnected")

# ══════════════════════════════════════════════
#  HTTPS FILE SERVER
# ══════════════════════════════════════════════
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):
        super().__init__(*a, directory=STATIC_DIR, **kw)

    def do_GET(self):
        # Route / based on user-agent: phone → phone.html, desktop → laptop.html
        if self.path == "/":
            ua = self.headers.get("User-Agent","").lower()
            is_mobile = any(x in ua for x in ["android","iphone","ipad","mobile"])
            self.path = "/phone.html" if is_mobile else "/laptop.html"
        super().do_GET()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Cross-Origin-Opener-Policy","same-origin")
        self.send_header("Cross-Origin-Embedder-Policy","require-corp")
        super().end_headers()

    def log_message(self,fmt,*args):
        code = str(args[1]) if len(args)>1 else "?"
        if code not in ("200","304","206"):
            print("  HTTP " + code + " " + str(args[0]))

def start_https(ssl_ctx, port):
    if not os.path.isdir(STATIC_DIR):
        os.makedirs(STATIC_DIR, exist_ok=True)
    srv = HTTPServer(("", port), Handler)
    srv.socket = ssl_ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    files = os.listdir(STATIC_DIR) if os.path.isdir(STATIC_DIR) else []
    print("  OK HTTPS on port " + str(port) + " | files: " + ", ".join(files))

# ══════════════════════════════════════════════
#  SSL
# ══════════════════════════════════════════════
def make_ssl():
    cert = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cert.pem")
    key  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "key.pem")
    if not os.path.exists(cert):
        print("  ERROR: cert.pem not found. Run: python generate_cert.py")
        sys.exit(1)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx

# ══════════════════════════════════════════════
#  ADB
# ══════════════════════════════════════════════
def setup_adb():
    try:
        r = subprocess.run(["adb","version"],capture_output=True,text=True,timeout=5)
        if r.returncode!=0: return False,"ADB not found"
        d = subprocess.run(["adb","devices"],capture_output=True,text=True,timeout=5)
        lines=[l for l in d.stdout.strip().split("\n")[1:] if "device" in l and "offline" not in l]
        if not lines: return False,"No USB device found"
        subprocess.run(["adb","reverse","tcp:"+str(HTTPS_PORT),"tcp:"+str(HTTPS_PORT)],capture_output=True)
        subprocess.run(["adb","reverse","tcp:"+str(WSS_PORT),  "tcp:"+str(WSS_PORT)],  capture_output=True)
        return True, lines[0].split("\t")[0]
    except FileNotFoundError: return False,"ADB not installed"
    except Exception as e:    return False,str(e)

def get_ip():
    try:
        s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(("8.8.8.8",80))
        ip=s.getsockname()[0]; s.close(); return ip
    except: return "127.0.0.1"

# ══════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════
async def main():
    print("\n" + "="*52)
    print("  CINEML PRO v3 — SERVER")
    print("="*52)
    print("\n[1/4] Loading ML model...")
    load_model()
    print("\n[2/4] SSL setup...")
    ssl_ctx = make_ssl()
    print("  OK")
    print("\n[3/4] Starting servers...")
    start_https(ssl_ctx, HTTPS_PORT)
    await websockets.serve(ws_handler, "0.0.0.0", WSS_PORT, ssl=ssl_ctx)
    print("  OK WSS on port " + str(WSS_PORT))
    print("\n[4/4] USB/ADB check...")
    adb_ok, adb_msg = setup_adb()

    ip = get_ip()
    print("\n" + "="*52)
    print("  OPEN THESE IN BROWSER:")
    print("="*52)
    print("")
    print("  LAPTOP (open on THIS computer):")
    print("  https://localhost:" + str(HTTPS_PORT))
    print("")
    print("  PHONE (open on phone Chrome):")
    print("  https://" + ip + ":" + str(HTTPS_PORT))
    if adb_ok:
        print("")
        print("  USB CONNECTED: " + adb_msg)
        print("  Phone can also use: https://localhost:" + str(HTTPS_PORT))
    else:
        print("  USB: " + adb_msg)
    print("")
    print("  Both will show cert warning — tap Advanced -> Proceed")
    print("  (Safe — your own server)")
    print("")
    print("  Waiting for connections... Ctrl+C to stop.")
    print("="*52+"\n")

    await asyncio.Future()

if __name__=="__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: print("\n  Stopped.")
