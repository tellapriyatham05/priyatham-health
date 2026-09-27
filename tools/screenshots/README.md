# Screenshot seeder

`shot.html` fills the web preview with realistic demo data, then opens a screen. It's used to make the images in `docs/screenshots/`.

```powershell
copy tools\screenshots\shot.html www\shot.html
cd www; python -m http.server 8765
# for each screen:
msedge --headless=new --window-size=500,1000 --force-device-scale-factor=1.5 --virtual-time-budget=6000 `
  --screenshot=docs\screenshots\today.png "http://127.0.0.1:8765/shot.html?r=today"
del www\shot.html   # never ship it in the app
```
