import { Button } from "@/components/ui/button"

const DOTS = Array.from({ length: 40 }, (_, i) => ({
  cx: (i % 5) * 20 + 10,
  cy: Math.floor(i / 5) * 20 + 10,
  delay: i * 80,
}))

const RACKS = [0, 1, 2]

function ServerGraphic() {
  return (
    <svg width="220" height="260" viewBox="0 0 220 260" fill="none" aria-hidden="true">
      {DOTS.map((dot, i) => (
        <circle
          key={i}
          cx={dot.cx}
          cy={dot.cy}
          r={3}
          fill="#00e5ff"
          style={{
            animation: "dot-pulse 2s ease-in-out infinite",
            animationDelay: `${dot.delay}ms`,
          }}
        />
      ))}
      {RACKS.map((rackIndex) => (
        <g key={rackIndex} transform={`translate(0, ${178 + rackIndex * 26})`}>
          <rect
            x="10"
            y="0"
            width="160"
            height="18"
            rx="3"
            fill="#1a1a2e"
            stroke="#2a2a3e"
            strokeWidth="1"
          />
          <circle
            cx="182"
            cy="9"
            r="4"
            fill="#00ff88"
            style={{
              animation: "dot-pulse 3s ease-in-out infinite",
              animationDelay: `${rackIndex * 600}ms`,
            }}
          />
        </g>
      ))}
    </svg>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col md:flex-row bg-[#0a0a0f] text-white">
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-12">
        <h1
          className="text-8xl font-bold tracking-tight"
          style={{ textShadow: "0 0 48px rgba(0,229,255,0.35)" }}
        >
          voz.gg
        </h1>
        <p className="text-lg text-white/40">Your servers. Your community.</p>
        <Button disabled className="mt-2 px-8">
          Sign In
        </Button>
      </div>
      <div className="hidden md:flex flex-1 items-center justify-center bg-[#0d0d14] border-l border-[#1a1a2e]">
        <ServerGraphic />
      </div>
    </main>
  )
}
