import { Radar, RadarChart as RechartsRadar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Signature 60'6" ID evaluation visual.
 * Expects categories scored 0–10; optionally overlay benchmarks 0–10.
 */
export function IdRadarChart({
  data = [],
  benchmarkData = null,
  height = 280,
}) {
  // data: [{ category, score }]  score 0-10
  const chartData = (data || []).map((d) => {
    const row = {
      category: d.category || d.label || d.key,
      score: Number(d.score ?? d.value ?? 0),
    };
    if (benchmarkData) {
      const b = benchmarkData.find(
        (x) => (x.category || x.label || x.key) === row.category
      );
      if (b) row.benchmark = Number(b.score ?? b.value ?? 0);
    }
    return row;
  });

  if (chartData.length < 3) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        Need at least 3 scored categories for the radar.
      </div>
    );
  }

  return (
    <div className="w-full" data-testid="id-radar-chart">
      <ResponsiveContainer width="100%" height={height}>
        <RechartsRadar data={chartData} outerRadius="72%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="category"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
          />
          {benchmarkData && (
            <Radar
              name="Benchmark"
              dataKey="benchmark"
              stroke="hsl(var(--muted-foreground))"
              fill="hsl(var(--muted-foreground))"
              fillOpacity={0.08}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          <Radar
            name="Score"
            dataKey="score"
            stroke="hsl(var(--brand))"
            fill="hsl(var(--brand))"
            fillOpacity={0.28}
            strokeWidth={2}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--surface-2))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 12,
              color: "hsl(var(--foreground))",
            }}
          />
        </RechartsRadar>
      </ResponsiveContainer>
    </div>
  );
}

export default IdRadarChart;
