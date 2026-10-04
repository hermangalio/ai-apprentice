// The faint wave lines behind the capture screens. Decoration only: it sits
// under the content, never catches a click and is hidden from screen readers.
export function PageWaves() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1440 900" fill="none">
        <g stroke="#dcdcee" strokeWidth="1" fill="none">
          <path d="M-40 120C180 40 420 40 640 108c240 74 470 92 700 10l140-54" />
          <path d="M-40 150C180 70 420 70 640 138c240 74 470 92 700 10l140-54" />
          <path d="M-40 182C180 102 420 102 640 170c240 74 470 92 700 10l140-54" />
        </g>
        <g stroke="#e4e4f4" strokeWidth="1" fill="none">
          <path d="M-40 742C200 690 380 760 620 788c260 30 520-16 760-104l100-38" />
          <path d="M-40 786C200 734 380 804 620 832c260 30 520-16 760-104l100-38" />
          <path d="M-40 830C200 778 380 848 620 876c260 30 520-16 760-104l100-38" />
        </g>
      </svg>
    </div>
  );
}

export default PageWaves;
