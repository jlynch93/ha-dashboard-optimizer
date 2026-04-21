const TIPS = [
  {
    title: "Auto-Discovery",
    desc: "Automatically finds your Ollama server and lists available models. Scan LAN probes common private IPs.",
  },
  {
    title: "HA Integration",
    desc: "Connects directly to Home Assistant to fetch all entities, areas, and devices. Token stays in memory only.",
  },
  {
    title: "Streaming Generation",
    desc: "Creates multi-view dashboards with optimal card types based on your actual entities, streamed live.",
  },
];

export function TipsSection() {
  return (
    <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
      {TIPS.map((tip) => (
        <div
          key={tip.title}
          className="p-4 bg-slate-800/30 border border-slate-700/50 rounded-xl"
        >
          <h3 className="text-sm font-semibold text-cyan-400 mb-1">{tip.title}</h3>
          <p className="text-xs text-slate-400">{tip.desc}</p>
        </div>
      ))}
    </div>
  );
}
