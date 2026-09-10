document.addEventListener('DOMContentLoaded', () => {
  const svg = d3.select('#viz');
  if (svg.empty()) return;
  svg.selectAll('circle')
    .data([30, 80, 45, 60, 20])
    .join('circle')
    .attr('cx', (_, i) => 60 + i * 70)
    .attr('cy', 140)
    .attr('r', d => d / 3)
    .attr('fill', '#6366f1');
});
