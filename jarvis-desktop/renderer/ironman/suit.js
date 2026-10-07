// The built-in Iron Man (used until you choose your own picture). A drawn suit, so it is
// free to share; your own photo is never put in the repository.
window.IRONMAN_SVG = `
<svg viewBox="0 0 100 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e0262f"/><stop offset="0.55" stop-color="#a8141b"/><stop offset="1" stop-color="#6e0b10"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe08a"/><stop offset="0.5" stop-color="#e3b341"/><stop offset="1" stop-color="#a77a17"/>
    </linearGradient>
    <radialGradient id="reactor"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#bff4ff"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
  </defs>
  <!-- legs -->
  <path d="M36 112 L48 112 L47 160 L45 190 L33 190 L33 160 Z" fill="url(#red)"/>
  <path d="M52 112 L64 112 L67 160 L67 190 L55 190 L53 160 Z" fill="url(#red)"/>
  <path d="M37 120 L47 120 L46 150 L36 150 Z M53 120 L63 120 L64 150 L54 150 Z" fill="url(#gold)" opacity="0.9"/>
  <path d="M32 186 L46 186 L47 197 L31 197 Z M54 186 L68 186 L69 197 L53 197 Z" fill="#7a0c12"/>
  <!-- arms -->
  <path d="M22 58 L32 56 L33 92 L27 112 L18 110 L21 90 Z" fill="url(#red)"/>
  <path d="M78 58 L68 56 L67 92 L73 112 L82 110 L79 90 Z" fill="url(#red)"/>
  <path d="M20 88 L30 88 L27 108 L18 107 Z M80 88 L70 88 L73 108 L82 107 Z" fill="url(#gold)"/>
  <circle cx="22" cy="116" r="5" fill="#8a1016"/><circle cx="78" cy="116" r="5" fill="#8a1016"/>
  <!-- torso -->
  <path d="M30 52 Q50 44 70 52 L68 86 Q50 94 32 86 Z" fill="url(#red)"/>
  <path d="M38 84 L62 84 L60 112 L40 112 Z" fill="url(#gold)"/>
  <path d="M41 90 L59 90 M41 97 L59 97 M42 104 L58 104" stroke="#8a6512" stroke-width="1.2"/>
  <path d="M24 52 Q30 46 38 50 L34 62 Q27 62 24 58 Z M76 52 Q70 46 62 50 L66 62 Q73 62 76 58 Z" fill="url(#gold)"/>
  <circle class="reactor" cx="50" cy="66" r="9" fill="url(#reactor)"/>
  <circle cx="50" cy="66" r="4.2" fill="#e0fbff" stroke="#7dd3fc" stroke-width="1.4"/>
  <!-- helmet -->
  <path d="M36 22 Q36 6 50 6 Q64 6 64 22 L63 38 Q57 46 50 46 Q43 46 37 38 Z" fill="url(#red)"/>
  <path d="M40 22 Q40 14 50 14 Q60 14 60 22 L59 35 Q55 41 50 41 Q45 41 41 35 Z" fill="url(#gold)"/>
  <path class="eyes" d="M42 25 L48 26.5 L47.5 28.5 L42.5 27.5 Z M58 25 L52 26.5 L52.5 28.5 L57.5 27.5 Z" fill="#e8fdff"/>
  <path d="M45 35 L55 35" stroke="#8a6512" stroke-width="1.2"/>
</svg>`;
// Where the boots are in the drawing above (fraction of width / height).
window.IRONMAN_FEET = [{ x: 0.39, y: 0.97 }, { x: 0.61, y: 0.97 }];
