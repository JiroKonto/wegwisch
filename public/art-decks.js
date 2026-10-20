'use strict';
// Small illustrations for the smart-deck tiles. Each uses its tile's accent colour via currentColor.
Object.assign(ART, {
  junk: `<svg viewBox="0 0 64 64" class="art"><path d="M44 8 L30 34" stroke="#c9a27a" stroke-width="4" stroke-linecap="round"/>
    <path d="M22 32 L38 40 L32 56 Q20 56 12 48 Z" fill="#1f2330" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M18 44 L26 48 M16 49 L24 53" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <circle cx="48" cy="48" r="2.5" fill="currentColor"/><circle cx="54" cy="40" r="1.8" fill="currentColor" opacity=".6"/><circle cx="50" cy="56" r="1.5" fill="currentColor" opacity=".5"/></svg>`,
  bigold: `<svg viewBox="0 0 64 64" class="art"><path d="M14 6 H36 L48 18 V56 H14 Z" fill="#1f2330" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M36 6 V18 H48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="44" cy="46" r="12" fill="#14161e" stroke="currentColor" stroke-width="2.5"/><path d="M44 39 V46 L49 49" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <rect x="20" y="24" width="18" height="3" rx="1.5" fill="currentColor" opacity=".5"/><rect x="20" y="31" width="12" height="3" rx="1.5" fill="currentColor" opacity=".35"/></svg>`,
  dupes: `<svg viewBox="0 0 64 64" class="art"><rect x="8" y="10" width="28" height="36" rx="4" fill="#1f2330" stroke="currentColor" stroke-width="2.5" opacity=".55"/>
    <rect x="26" y="18" width="28" height="36" rx="4" fill="#1f2330" stroke="currentColor" stroke-width="2.5"/>
    <path d="M33 31 H47 M33 38 H47" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  growth: `<svg viewBox="0 0 64 64" class="art"><rect x="10" y="38" width="9" height="16" rx="2" fill="currentColor" opacity=".35"/>
    <rect x="24" y="30" width="9" height="24" rx="2" fill="currentColor" opacity=".55"/><rect x="38" y="20" width="9" height="34" rx="2" fill="currentColor" opacity=".8"/>
    <path d="M10 30 L26 20 L36 24 L54 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M45 8 H54 V17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  programs: `<svg viewBox="0 0 64 64" class="art"><rect x="6" y="10" width="46" height="38" rx="6" fill="#1f2330" stroke="currentColor" stroke-width="2.5"/>
    <path d="M6 20 H52" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/><circle cx="17" cy="15" r="1.6" fill="currentColor" opacity=".6"/>
    <rect x="13" y="26" width="10" height="8" rx="2" fill="currentColor" opacity=".7"/><rect x="27" y="26" width="10" height="8" rx="2" fill="currentColor" opacity=".45"/><rect x="13" y="37" width="10" height="6" rx="2" fill="currentColor" opacity=".45"/>
    <circle cx="48" cy="48" r="10" fill="#14161e" stroke="#ff4d6d" stroke-width="2.5"/><path d="M43 48 H53" stroke="#ff4d6d" stroke-width="3" stroke-linecap="round"/></svg>`,
  extras: `<svg viewBox="0 0 64 64" class="art"><g fill="currentColor"><rect x="8" y="8" width="17" height="17" rx="2" opacity=".85"/><rect x="28" y="8" width="17" height="17" rx="2" opacity=".6"/>
    <rect x="8" y="28" width="17" height="17" rx="2" opacity=".6"/><rect x="28" y="28" width="17" height="17" rx="2" opacity=".35"/></g>
    <circle cx="46" cy="46" r="11" fill="#14161e" stroke="currentColor" stroke-width="2.5"/><circle cx="46" cy="46" r="4" fill="none" stroke="currentColor" stroke-width="2.5"/>
    <path d="M46 31v4M46 57v4M31 46h4M57 46h4M35.4 35.4l2.8 2.8M53.8 53.8l2.8 2.8M35.4 56.6l2.8-2.8M53.8 38.2l2.8-2.8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  bin: `<svg viewBox="0 0 64 64" class="art"><path d="M14 18 H50 L46 56 H18 Z" fill="#1f2330" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M10 18 H54" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M26 18 V12 H38 V18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M26 27 L27 48 M32 27 V48 M38 27 L37 48" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".6"/></svg>`,
});
