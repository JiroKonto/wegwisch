'use strict';
// Hand-drawn SVG art in the app's style: dark bodies, brand gradient outlines (gradient #wwg is defined in index.html).
const ART = {
  nvme: `<svg viewBox="0 0 120 64" class="art"><rect x="6" y="18" width="104" height="28" rx="5" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
    <path d="M110 22v20" stroke="#0c0d12" stroke-width="5"/><circle cx="12" cy="32" r="3.5" fill="#0c0d12" stroke="url(#wwg)" stroke-width="2"/>
    <rect x="22" y="23" width="26" height="18" rx="2" fill="#2a2f40"/><rect x="54" y="23" width="18" height="18" rx="2" fill="#2a2f40"/><rect x="76" y="23" width="18" height="18" rx="2" fill="#2a2f40"/>
    <g fill="#ffb547">${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${99 + (i % 2) * 0}" y="${21 + i * 4}" width="7" height="2" rx="1"/>`).join('')}</g>
    <text x="35" y="35" font-size="6" fill="#a78bfa" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">NVMe</text></svg>`,
  ssd: `<svg viewBox="0 0 120 64" class="art"><rect x="22" y="6" width="76" height="52" rx="7" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
    <rect x="32" y="16" width="56" height="22" rx="3" fill="#2a2f40"/><text x="60" y="31" font-size="9" fill="#2fd47a" font-family="Inter,sans-serif" text-anchor="middle" font-weight="800">SSD</text>
    <g fill="#0c0d12" stroke="#4a5068" stroke-width="1.2"><circle cx="29" cy="13" r="2"/><circle cx="91" cy="13" r="2"/><circle cx="29" cy="51" r="2"/><circle cx="91" cy="51" r="2"/></g>
    <rect x="40" y="46" width="40" height="5" rx="1.5" fill="#ffb547" opacity=".8"/></svg>`,
  hdd: `<svg viewBox="0 0 120 64" class="art"><rect x="24" y="4" width="72" height="56" rx="7" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
    <circle cx="56" cy="30" r="20" fill="#2a2f40" stroke="#4a5068" stroke-width="1.5"/><circle cx="56" cy="30" r="13" fill="none" stroke="#353a4c" stroke-width="1"/>
    <circle cx="56" cy="30" r="4" fill="#0c0d12" stroke="#a78bfa" stroke-width="1.5"/><path d="M86 52 L68 38" stroke="#ff4d6d" stroke-width="3" stroke-linecap="round"/>
    <circle cx="86" cy="52" r="3.5" fill="#ff4d6d"/></svg>`,
  usb: `<svg viewBox="0 0 120 64" class="art"><rect x="18" y="16" width="64" height="32" rx="9" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
    <rect x="82" y="22" width="22" height="20" rx="2" fill="#2a2f40" stroke="#4a5068" stroke-width="1.5"/><rect x="89" y="27" width="4" height="4" fill="#0c0d12"/><rect x="96" y="27" width="4" height="4" fill="#0c0d12"/>
    <circle cx="30" cy="32" r="3" fill="#2fd47a"/></svg>`,
  disk: `<svg viewBox="0 0 120 64" class="art"><rect x="20" y="10" width="80" height="44" rx="8" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
    <rect x="30" y="38" width="50" height="6" rx="3" fill="#2a2f40"/><circle cx="88" cy="41" r="3" fill="#2fd47a"/></svg>`,
  swipe: `<svg viewBox="0 0 200 140" class="art"><g transform="rotate(10 120 70)"><rect x="80" y="18" width="78" height="104" rx="12" fill="#1a1d27" stroke="#2a2e3b" stroke-width="2"/></g>
    <g transform="rotate(4 110 70)"><rect x="70" y="18" width="78" height="104" rx="12" fill="#1c1f2b" stroke="#2f3343" stroke-width="2"/></g>
    <g transform="rotate(-8 90 70)"><rect x="56" y="18" width="78" height="104" rx="12" fill="#1f2330" stroke="url(#wwg)" stroke-width="2.5"/>
      <rect x="66" y="30" width="22" height="16" rx="3" fill="#ffb547"/><rect x="66" y="54" width="50" height="7" rx="3.5" fill="#eef0f6"/><rect x="66" y="68" width="34" height="12" rx="3" fill="#eef0f6" opacity=".9"/>
      <rect x="66" y="88" width="56" height="4" rx="2" fill="#262a37"/><rect x="66" y="88" width="24" height="4" rx="2" fill="#2fd47a"/></g>
    <circle cx="28" cy="74" r="16" fill="#14161e" stroke="#ff4d6d" stroke-width="2"/><path d="M22 68l12 12M34 68l-12 12" stroke="#ff4d6d" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="176" cy="74" r="16" fill="#14161e" stroke="#2fd47a" stroke-width="2"/><path d="M169 74l5 5 9-10" stroke="#2fd47a" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
  classic: `<svg viewBox="0 0 200 140" class="art"><rect x="20" y="14" width="160" height="112" rx="12" fill="#1a1d27" stroke="url(#wwg)" stroke-width="2.5"/>
    <rect x="30" y="24" width="72" height="56" rx="4" fill="#ff4d6d" opacity=".85"/><rect x="104" y="24" width="66" height="32" rx="4" fill="#a78bfa" opacity=".85"/>
    <rect x="104" y="58" width="36" height="22" rx="4" fill="#2fd47a" opacity=".85"/><rect x="142" y="58" width="28" height="22" rx="4" fill="#4ea8ff" opacity=".85"/>
    ${[0, 1, 2].map(i => `<rect x="30" y="${88 + i * 11}" width="140" height="7" rx="3" fill="#262a37"/><rect x="30" y="${88 + i * 11}" width="${90 - i * 28}" height="7" rx="3" fill="${['#ff4d6d', '#a78bfa', '#2fd47a'][i]}" opacity=".7"/>`).join('')}</svg>`,
};
