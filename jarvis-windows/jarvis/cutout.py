"""Offline background removal for your character image (U^2-Net small model on ONNX Runtime)."""
import os

import numpy as np

from .audio import resource


def _plain_background_alpha(rgba, tol=38.0):
    """For pictures on a plain background (like a white studio shot): the background is the
    region of near-background colour connected to the edges. Returns an alpha mask, or None."""
    from collections import deque
    h, w = rgba.shape[:2]
    rgb = rgba[:, :, :3].astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    near_border = np.linalg.norm(border - bg, axis=1) < tol
    if near_border.mean() < 0.85:
        return None            # busy background: let the AI model handle it
    dist = np.linalg.norm(rgb - bg, axis=2)
    cand = dist < tol
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    alpha = np.where(seen, 0.0, 1.0)
    # Soft edge: background-connected pixels that are only slightly off-colour become semi-transparent.
    edge = seen & (dist > tol * 0.5)
    alpha[edge] = (dist[edge] - tol * 0.5) / (tol * 0.5) * 0.6
    return (alpha * 255).astype(np.uint8)


def remove_background(src_path, dst_path):
    """Writes a PNG of the image with its background made transparent. Returns dst_path."""
    import onnxruntime as ort
    from PySide6.QtGui import QImage

    img = QImage(src_path).convertToFormat(QImage.Format_RGBA8888)
    if img.isNull():
        raise ValueError("That file isn't an image JARVIS can read.")
    w, h = img.width(), img.height()
    ptr = img.constBits()
    rgba = np.frombuffer(ptr, np.uint8, count=img.sizeInBytes()).reshape(h, img.bytesPerLine() // 4, 4)[:, :w].copy()

    plain = _plain_background_alpha(rgba)
    if plain is not None:
        rgba[:, :, 3] = plain
        return _save_cropped(rgba, plain, dst_path)

    small = QImage(src_path).convertToFormat(QImage.Format_RGB888).scaled(320, 320)
    sp = small.constBits()
    rgb = np.frombuffer(sp, np.uint8, count=small.sizeInBytes()).reshape(320, small.bytesPerLine())[:, :960].reshape(320, 320, 3)
    x = rgb.astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    x = x.transpose(2, 0, 1)[None]

    sess = ort.InferenceSession(resource("models", "u2netp.onnx"), providers=["CPUExecutionProvider"])
    mask = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    mask = (mask - mask.min()) / max(1e-6, float(mask.max() - mask.min()))
    # Firm up the edges a little, then scale the mask to the full image.
    mask = np.clip((mask - 0.25) / 0.5, 0, 1)
    m8 = (mask * 255).astype(np.uint8)
    mimg = QImage(m8.data, 320, 320, 320, QImage.Format_Grayscale8).scaled(w, h)
    mp = mimg.constBits()
    alpha = np.frombuffer(mp, np.uint8, count=mimg.sizeInBytes()).reshape(h, mimg.bytesPerLine())[:, :w]
    rgba[:, :, 3] = alpha
    return _save_cropped(rgba, alpha, dst_path)


def _save_cropped(rgba, alpha, dst_path):
    from PySide6.QtGui import QImage
    h, w = alpha.shape
    # Crop to the figure so it sits neatly in the corner.
    ys, xs = np.where(alpha > 40)
    if len(xs):
        pad = 6
        x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
        rgba = np.ascontiguousarray(rgba[y0:y1, x0:x1])
    out = QImage(rgba.data, rgba.shape[1], rgba.shape[0], rgba.shape[1] * 4, QImage.Format_RGBA8888)
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    out.save(dst_path, "PNG")
    return dst_path
