/** Map a front-facing rectangle onto the four projected corners of a card.
 * Corner probes inherit every ancestor's rotation and perspective, unlike a bounding box.
 */
export function inspectionSourceTransform(element: HTMLElement, width: number, height: number): string {
  const corners = [...element.querySelectorAll<HTMLElement>('[data-inspection-corner]')].map(probe => probe.getBoundingClientRect());
  if (corners.length !== 4) {
    const box = element.getBoundingClientRect();
    return `matrix(${box.width / width},0,0,${box.height / height},${box.left},${box.top})`;
  }
  const [p0, p1, p2, p3] = corners.map(box => ({ x: box.left, y: box.top }));
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) < 0.0001 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator;
  const h = Math.abs(denominator) < 0.0001 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator;
  return `matrix3d(${(p1.x - p0.x + g * p1.x) / width},${(p1.y - p0.y + g * p1.y) / width},0,${g / width},${(p3.x - p0.x + h * p3.x) / height},${(p3.y - p0.y + h * p3.y) / height},0,${h / height},0,0,1,0,${p0.x},${p0.y},0,1)`;
}
