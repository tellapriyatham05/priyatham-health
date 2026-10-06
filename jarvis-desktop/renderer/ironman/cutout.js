// Your character picture: removes a plain background (like a white studio photo),
// trims the empty edges, and finds where the boots are so the flames line up.
// Everything happens here on your PC.
(function () {
  const MAX = 700; // working size in pixels (plenty for a character a few hundred pixels tall)

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't a picture JARVIS can read"));
      img.src = src;
    });
  }

  function toCanvas(img) {
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Background = pixels close to the border colour that are connected to the edge.
  function removePlainBackground(data, w, h, tol = 38) {
    const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const border = [];
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    const med = [0, 1, 2].map((ch) => {
      const v = border.map((i) => data[i * 4 + ch]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    const dist = (i) => { const p = px(i); return Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]); };
    const near = border.filter((i) => dist(i) < tol).length / border.length;
    if (near < 0.85) return false; // a busy photo background: keep the picture as it is
    const seen = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (const i of border) if (!seen[i] && dist(i) < tol) { seen[i] = 1; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && !seen[n] && dist(n) < tol) { seen[n] = 1; queue[tail++] = n; }
      }
    }
    for (let i = 0; i < w * h; i++) {
      if (!seen[i]) continue;
      const d = dist(i);
      data[i * 4 + 3] = d > tol * 0.5 ? Math.round(((d - tol * 0.5) / (tol * 0.5)) * 0.6 * 255) : 0;
    }
    return true;
  }

  function hasTransparency(data, w, h) {
    let clear = 0, total = 0;
    for (let x = 0; x < w; x += 3) { total += 2; if (data[x * 4 + 3] < 30) clear++; if (data[((h - 1) * w + x) * 4 + 3] < 30) clear++; }
    return clear / total > 0.5;
  }

  function crop(canvas, ctx) {
    const { width: w, height: h } = canvas;
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return canvas;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // The boots: the two legs separate a little above the soles even when the feet touch,
  // so find the lowest row with two separate solid parts, then each boot's sole below it.
  // Returns [{x, y}] as fractions of the picture (y = the sole).
  function findFeet(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const solid = (x, y) => d[(y * w + x) * 4 + 3] > 110;
    const runsAt = (y) => {
      const runs = [];
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const s = x < w && solid(x, y);
        if (s && start < 0) start = x;
        if (!s && start >= 0) { if (x - start >= 2) runs.push([start, x - 1]); start = -1; }
      }
      return runs;
    };
    let bottom = h - 1;
    while (bottom > 0 && !runsAt(bottom).length) bottom--;
    let left = null, right = null;
    for (let y = bottom; y > bottom - h * 0.2 && y > 0; y--) {
      const runs = runsAt(y).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 2).sort((p, q) => p[0] - q[0]);
      if (runs.length === 2 && runs[1][0] - runs[0][1] >= Math.max(2, w * 0.01)) {
        left = (runs[0][0] + runs[0][1]) / 2;
        right = (runs[1][0] + runs[1][1]) / 2;
        break;
      }
    }
    if (left === null) {
      // Feet drawn as one shape: put the jets on its left and right thirds.
      const [run] = runsAt(bottom).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
      const span = run[1] - run[0];
      left = run[0] + span * 0.27;
      right = run[1] - span * 0.27;
    }
    // Each sole: the lowest solid pixel near that boot's centre.
    const sole = (cx) => {
      for (let y = h - 1; y > 0; y--) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(cx) + dx;
          if (x >= 0 && x < w && solid(x, y)) return y;
        }
      }
      return bottom;
    };
    return [{ x: left / w, y: sole(left) / h }, { x: right / w, y: sole(right) / h }];
  }

  // Picture file (data URL) -> { src: PNG data URL, framed: true when the background was kept }
  async function prepareCharacter(src) {
    const canvas = toCanvas(await loadImage(src));
    const ctx = canvas.getContext('2d');
    const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let cut = hasTransparency(im.data, canvas.width, canvas.height);
    if (!cut) {
      cut = removePlainBackground(im.data, canvas.width, canvas.height);
      if (cut) ctx.putImageData(im, 0, 0);
    }
    const out = cut ? crop(canvas, ctx) : canvas;
    return { src: out.toDataURL('image/png'), framed: !cut };
  }

  async function feetOf(src) {
    return findFeet(toCanvas(await loadImage(src)));
  }

  window.JarvisCutout = { prepareCharacter, feetOf };
})();
