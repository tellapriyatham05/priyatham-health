#!/usr/bin/env bash
# Builds JARVIS.apk without Gradle or the Android SDK manager.
#
# Needs: JDK 17+, and the Debian/Ubuntu packages aapt, dalvik-exchange (dx),
# zipalign and apksigner:
#   sudo apt-get install aapt dalvik-exchange zipalign apksigner
# The Android platform jar and ONNX Runtime are downloaded once into .cache/.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
CACHE="$ROOT/.cache"
OUT="$ROOT/build"
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1}"
ORT_VERSION="1.20.0"
ANDROID_JAR="$CACHE/android-34.jar"
ORT_AAR="$CACHE/onnxruntime-android-$ORT_VERSION.aar"
KEYSTORE="$ROOT/keystore/jarvis.keystore"
KS_PASS="jarvis-personal"

mkdir -p "$CACHE"
if [ ! -s "$ANDROID_JAR" ]; then
  echo "Downloading android.jar (API 34)..."
  curl -fsSL -o "$ANDROID_JAR" https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
fi
if [ ! -s "$ORT_AAR" ]; then
  echo "Downloading ONNX Runtime $ORT_VERSION..."
  curl -fsSL -o "$ORT_AAR" "https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/$ORT_VERSION/onnxruntime-android-$ORT_VERSION.aar"
fi

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/ort" "$OUT/apk/lib/arm64-v8a"

# ONNX Runtime: Java classes + the 64-bit ARM native libraries (all current OnePlus phones).
(cd "$OUT/ort" && unzip -q -o "$ORT_AAR" classes.jar 'jni/arm64-v8a/*')
cp "$OUT/ort/jni/arm64-v8a/"*.so "$OUT/apk/lib/arm64-v8a/"

echo "Packaging resources..."
aapt package -f -m \
  -M AndroidManifest.xml -S res -A assets \
  -I "$ANDROID_JAR" -J "$OUT/gen" \
  --min-sdk-version 26 --target-sdk-version 28 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 onnx \
  -F "$OUT/resources.apk"

echo "Compiling Java..."
find src "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" -cp "$OUT/ort/classes.jar" \
  -d "$OUT/classes" @"$OUT/sources.txt"

echo "Converting to dex..."
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/apk/classes.dex" "$OUT/classes" "$OUT/ort/classes.jar"

echo "Assembling APK..."
cp "$OUT/resources.apk" "$OUT/unsigned.apk"
(cd "$OUT/apk" && zip -q -r "$OUT/unsigned.apk" classes.dex lib)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias jarvis -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=JARVIS personal, O=Priyatham" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias jarvis \
  --out "$OUT/JARVIS.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/JARVIS.apk"

mkdir -p "$ROOT/release"
cp "$OUT/JARVIS.apk" "$ROOT/release/JARVIS.apk"
echo "Built: release/JARVIS.apk ($(du -h "$ROOT/release/JARVIS.apk" | cut -f1))"
