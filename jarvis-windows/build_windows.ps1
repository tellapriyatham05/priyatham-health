# Builds dist\JARVIS\JARVIS.exe and JARVIS-Windows.zip. Run in PowerShell from this folder:
#   powershell -ExecutionPolicy Bypass -File build_windows.ps1
$ErrorActionPreference = "Stop"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pyinstaller==6.22.3 pillow

# Offline speech models (downloaded once).
New-Item -ItemType Directory -Force -Path models | Out-Null
foreach ($m in @("vosk-model-small-en-in-0.4", "vosk-model-small-en-us-0.15")) {
  if (-not (Test-Path "models\$m")) {
    Invoke-WebRequest "https://alphacephei.com/vosk/models/$m.zip" -OutFile "$m.zip"
    Expand-Archive "$m.zip" -DestinationPath models -Force
    Remove-Item "$m.zip"
  }
}
if (-not (Test-Path "models\whisper-base.en\model.bin")) {
  python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base.en', local_dir='models/whisper-base.en')"
  Remove-Item -Recurse -Force "models\whisper-base.en\.cache" -ErrorAction SilentlyContinue
}

if (-not (Test-Path "models\u2netp.onnx")) {
  Invoke-WebRequest "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx" -OutFile "models\u2netp.onnx"
}

python -c "from PIL import Image, ImageDraw; im=Image.new('RGBA',(256,256),(0,0,0,0)); d=ImageDraw.Draw(im); d.ellipse((8,8,248,248),fill=(5,11,20),outline=(0,229,255),width=14); d.polygon([(76,86),(180,86),(128,178)],fill=(180,245,255)); im.save('jarvis.ico',sizes=[(256,256),(64,64),(32,32),(16,16)])"

pyinstaller --noconfirm --clean --windowed --name JARVIS --icon jarvis.ico `
  --add-data "models;models" `
  --collect-all vosk --collect-all faster_whisper --collect-all ctranslate2 --collect-all onnxruntime `
  --collect-all _sounddevice_data `
  --collect-submodules comtypes --collect-submodules pycaw --collect-submodules screen_brightness_control `
  --hidden-import win32com.client --hidden-import pythoncom `
  run_jarvis.py

Copy-Item README-WINDOWS.txt dist\JARVIS\ -Force
if (Test-Path JARVIS-Windows.zip) { Remove-Item JARVIS-Windows.zip }
Compress-Archive -Path dist\JARVIS -DestinationPath JARVIS-Windows.zip
Write-Host "Built JARVIS-Windows.zip"
