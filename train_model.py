# ═══════════════════════════════════════════════════════════════
#  CINEML PRO — ML TRAINING SCRIPT  (train_model.py)
#
#  Trains a CNN scene classifier on synthetic + augmented data.
#  Since you have no dataset, we generate training samples from
#  color statistics — this is called "programmatic dataset" approach.
#
#  HOW TO RUN:
#      python train_model.py
#
#  OUTPUT:
#      scene_model.h5    ← your trained model
#      label_map.json    ← scene label index
# ═══════════════════════════════════════════════════════════════

import numpy as np
import json
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # suppress TF spam

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from sklearn.model_selection import train_test_split

print("=" * 55)
print("  CINEML PRO — SCENE CLASSIFIER TRAINING")
print("=" * 55)

# ──────────────────────────────────────────────────────────────
#  SCENE DEFINITIONS
#  Each scene has color statistics that define it.
#  We generate thousands of synthetic 8x8 RGB samples per scene.
# ──────────────────────────────────────────────────────────────
SCENES = {
    "golden_hour":   {
        "lut": "golden",
        "avg_r": (200, 230), "avg_g": (140, 180), "avg_b": (60,  110),
        "brightness": (160, 220), "temp": (0.25, 0.60),
    },
    "sunset": {
        "lut": "kodak",
        "avg_r": (180, 215), "avg_g": (100, 150), "avg_b": (50,  90),
        "brightness": (120, 180), "temp": (0.15, 0.40),
    },
    "outdoor_day": {
        "lut": "arri",
        "avg_r": (120, 175), "avg_g": (120, 180), "avg_b": (140, 200),
        "brightness": (150, 230), "temp": (-0.10, 0.08),
    },
    "overcast": {
        "lut": "fuji",
        "avg_r": (130, 165), "avg_g": (130, 165), "avg_b": (145, 185),
        "brightness": (120, 170), "temp": (-0.12, -0.02),
    },
    "blue_hour": {
        "lut": "moon",
        "avg_r": (60,  110), "avg_g": (70,  120), "avg_b": (130, 180),
        "brightness": (60,  110), "temp": (-0.30, -0.10),
    },
    "night": {
        "lut": "bleach",
        "avg_r": (20,  70),  "avg_g": (20,  70),  "avg_b": (25,  75),
        "brightness": (10,  65),  "temp": (-0.10, 0.10),
    },
    "interior_warm": {
        "lut": "kodak",
        "avg_r": (155, 200), "avg_g": (110, 155), "avg_b": (60,  110),
        "brightness": (90,  150), "temp": (0.10, 0.30),
    },
    "interior_cool": {
        "lut": "fuji",
        "avg_r": (110, 155), "avg_g": (115, 160), "avg_b": (120, 165),
        "brightness": (90,  150), "temp": (-0.08, 0.05),
    },
    "portrait": {
        "lut": "arri",
        "avg_r": (160, 210), "avg_g": (110, 160), "avg_b": (80,  130),
        "brightness": (110, 185), "temp": (0.05, 0.25),
    },
    "high_contrast": {
        "lut": "bleach",
        "avg_r": (80,  150), "avg_g": (80,  150), "avg_b": (80,  150),
        "brightness": (80,  160), "temp": (-0.05, 0.05),
    },
}

SCENE_NAMES = list(SCENES.keys())
NUM_CLASSES  = len(SCENE_NAMES)
SAMPLES_PER_CLASS = 3000   # synthetic samples per scene
IMG_SIZE = 8               # 8x8 feature map (fast, not image-based)

# ──────────────────────────────────────────────────────────────
#  GENERATE SYNTHETIC TRAINING DATA
#  We encode each sample as a feature vector, not raw pixels.
#  Features: [avg_r, avg_g, avg_b, brightness, temp, contrast,
#             dark_ratio, bright_ratio, saturation]  → 9 features
# ──────────────────────────────────────────────────────────────
def generate_samples(scene_def, n):
    samples = []
    r_lo, r_hi = scene_def["avg_r"]
    g_lo, g_hi = scene_def["avg_g"]
    b_lo, b_hi = scene_def["avg_b"]
    br_lo, br_hi = scene_def["brightness"]
    t_lo, t_hi   = scene_def["temp"]

    for _ in range(n):
        avg_r  = np.random.uniform(r_lo, r_hi)
        avg_g  = np.random.uniform(g_lo, g_hi)
        avg_b  = np.random.uniform(b_lo, b_hi)
        bright = np.random.uniform(br_lo, br_hi)
        temp   = np.random.uniform(t_lo,  t_hi)

        # Derived features
        contrast    = np.random.uniform(0.2, 0.9)
        dark_ratio  = max(0, 1.0 - bright / 128.0) * np.random.uniform(0.5, 1.0)
        bright_ratio = max(0, bright / 200.0) * np.random.uniform(0.5, 1.0)
        saturation  = np.sqrt((avg_r - avg_g)**2 + (avg_g - avg_b)**2 + (avg_r - avg_b)**2) / 255.0

        # Add realistic noise (augmentation)
        noise = np.random.normal(0, 0.02, 9)

        feature = np.array([
            avg_r    / 255.0,
            avg_g    / 255.0,
            avg_b    / 255.0,
            bright   / 255.0,
            (temp + 1.0) / 2.0,   # normalize -1..1 → 0..1
            contrast,
            dark_ratio,
            bright_ratio,
            saturation,
        ]) + noise

        feature = np.clip(feature, 0.0, 1.0)
        samples.append(feature)

    return np.array(samples, dtype=np.float32)


print("\n[1/4] Generating synthetic training data...")
X_list, y_list = [], []

for idx, (scene_name, scene_def) in enumerate(SCENES.items()):
    samples = generate_samples(scene_def, SAMPLES_PER_CLASS)
    X_list.append(samples)
    y_list.append(np.full(SAMPLES_PER_CLASS, idx, dtype=np.int32))
    print(f"      {scene_name:20s} → {SAMPLES_PER_CLASS} samples")

X = np.vstack(X_list)
y = np.concatenate(y_list)

# Shuffle
idx = np.random.permutation(len(X))
X, y = X[idx], y[idx]

X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.15, random_state=42)
print(f"\n      Train: {len(X_train)} | Val: {len(X_val)}")

# ──────────────────────────────────────────────────────────────
#  BUILD MODEL
#  Simple but effective MLP — fast enough for real-time inference
#  (< 1ms per frame on any laptop)
# ──────────────────────────────────────────────────────────────
print("\n[2/4] Building model architecture...")

model = keras.Sequential([
    keras.Input(shape=(9,)),

    layers.Dense(64, activation='relu'),
    layers.BatchNormalization(),
    layers.Dropout(0.25),

    layers.Dense(128, activation='relu'),
    layers.BatchNormalization(),
    layers.Dropout(0.25),

    layers.Dense(64, activation='relu'),
    layers.BatchNormalization(),

    layers.Dense(NUM_CLASSES, activation='softmax'),
], name="CineML_SceneClassifier")

model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=0.001),
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy'],
)

model.summary()

# ──────────────────────────────────────────────────────────────
#  TRAIN
# ──────────────────────────────────────────────────────────────
print("\n[3/4] Training...")

callbacks = [
    keras.callbacks.EarlyStopping(
        monitor='val_accuracy',
        patience=8,
        restore_best_weights=True,
        verbose=1,
    ),
    keras.callbacks.ReduceLROnPlateau(
        monitor='val_loss',
        factor=0.5,
        patience=4,
        verbose=1,
    ),
]

history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=60,
    batch_size=128,
    callbacks=callbacks,
    verbose=1,
)

val_acc = max(history.history['val_accuracy'])
print(f"\n  Best validation accuracy: {val_acc*100:.1f}%")

# ──────────────────────────────────────────────────────────────
#  SAVE
# ──────────────────────────────────────────────────────────────
print("\n[4/4] Saving model...")

model.save("scene_model.h5")
print("  Saved: scene_model.h5")

# Save label map (scene index → name + LUT)
label_map = {
    str(idx): {
        "scene": name,
        "lut":   SCENES[name]["lut"],
    }
    for idx, name in enumerate(SCENE_NAMES)
}
with open("label_map.json", "w") as f:
    json.dump(label_map, f, indent=2)
print("  Saved: label_map.json")

print("\n" + "=" * 55)
print("  TRAINING COMPLETE!")
print(f"  Accuracy: {val_acc*100:.1f}%")
print("  Now run:  python server.py")
print("=" * 55)
