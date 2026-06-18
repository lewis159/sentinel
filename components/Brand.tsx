// Sentinel shield+radar mark (blue brand).
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="mark">
      <defs>
        <linearGradient id="sgm" x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5AA9FF" /><stop offset="0.5" stopColor="#2D6CFF" /><stop offset="1" stopColor="#1B4DD1" />
        </linearGradient>
        <linearGradient id="swm" x1="32" y1="30" x2="50" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9BD4FF" /><stop offset="1" stopColor="#38BDF8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M32 3.5 L55 13.5 V31 C55 45 45 54.5 32 60.5 C19 54.5 9 45 9 31 V13.5 Z" fill="url(#sgm)" />
      <path d="M32 30 L32 11 A19 19 0 0 1 49 21 Z" fill="url(#swm)" opacity="0.9" />
      <g stroke="#EAF3FF" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.95">
        <path d="M22.5 38 A13 13 0 0 1 32 17" /><path d="M26.5 38.5 A8.5 8.5 0 0 1 32 23.5" />
      </g>
      <circle cx="32" cy="30" r="4.2" fill="#EAF3FF" /><circle cx="32" cy="30" r="1.9" fill="#1B4DD1" />
    </svg>
  );
}
