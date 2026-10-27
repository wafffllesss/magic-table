import { describe, expect, it } from 'vitest';
import { CAMERA_PITCH_LIMITS, CARD_AREA, CARD_SIZE, MAT_HEIGHT, MAT_WIDTH, TABLE_SIZE, ZONE_GAP, ZONE_STEP, SEAT_PLACEMENT, clampCameraPitch, clampCardPosition, createTableView, projectPoint, screenToCardPosition, screenToMat, screenToTable, type SeatPosition } from './tableView';

function worldPoint(seatId: SeatPosition, localX: number, localY: number): { x: number; y: number; z: number } {
  const seat = SEAT_PLACEMENT[seatId];
  const angle = seat.angle * Math.PI / 180;
  const dx = localX - MAT_WIDTH / 2; const dy = localY - MAT_HEIGHT / 2;
  return { x: seat.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: seat.y + dx * Math.sin(angle) + dy * Math.cos(angle), z: 0 };
}

describe('square table projection', () => {
  it('allows a lower seat-view pitch to expose more of the local playmat', () => {
    expect(CAMERA_PITCH_LIMITS.min).toBe(-18);
    expect(clampCameraPitch(-30)).toBe(-18);
    expect(clampCameraPitch(30)).toBe(8);
    const level = createTableView(1460, 880, 'southWest', 'seat', 0, 0);
    const lower = createTableView(1460, 880, 'southWest', 'seat', 0, clampCameraPitch(-18));
    expect(lower.forward.z).toBeLessThan(level.forward.z);
    const local = createTableView(1200, 800, 'southEast', 'seat', 0, -18, 55, 240);
    for (const x of [0, MAT_WIDTH]) for (const y of [0, MAT_HEIGHT]) {
      const corner = projectPoint(local, worldPoint('southEast', x, y));
      expect(corner.x).toBeGreaterThan(0); expect(corner.x).toBeLessThan(960);
      expect(corner.y).toBeGreaterThan(0); expect(corner.y).toBeLessThan(800);
    }
  });
  for (const seatId of Object.keys(SEAT_PLACEMENT) as SeatPosition[]) {
    it(`returns a dragged card to the correct spot from ${seatId}`, () => {
      for (const fov of [25, 45, 55, 70]) for (const lean of [0, 0.5, 1]) for (const tapped of [false, true]) {
        const view = createTableView(1460, 880, seatId, 'seat', 18, 8, fov, 0, lean);
        const localX = CARD_AREA.left + CARD_AREA.width * 0.47;
        const localY = CARD_AREA.top + CARD_AREA.height * 0.52;
        const screen = projectPoint(view, worldPoint(seatId, localX, localY));
        const local = screenToMat(view, screen.x, screen.y, seatId);
        const card = screenToCardPosition(view, screen.x, screen.y, seatId, tapped);
        expect(local?.x).toBeCloseTo(localX, 5);
        expect(local?.y).toBeCloseTo(localY, 5);
        expect(card?.x).toBeCloseTo(47, 5);
        expect(card?.y).toBeCloseTo(52, 5);
        const offset = { x: 17, y: -21 };
        const grabbed = projectPoint(view, worldPoint(seatId, localX + offset.x, localY + offset.y));
        const anchored = screenToCardPosition(view, grabbed.x, grabbed.y, seatId, tapped, offset);
        expect(anchored?.x).toBeCloseTo(47, 5); expect(anchored?.y).toBeCloseTo(52, 5);
      }
    });
  }

  it('keeps spectator overhead and centers the square board', () => {
    const view = createTableView(1400, 900, undefined, 'overview');
    const center = projectPoint(view, { x: TABLE_SIZE / 2, y: TABLE_SIZE / 2, z: 0 });
    expect(center.x).toBeCloseTo(700);
    expect(center.y).toBeCloseTo(450);
  });

  it('fits every table corner in the overview on wide and narrow screens', () => {
    for (const [width, height, reserved] of [[1460, 880, 0], [390, 799, 0], [390, 799, 135]]) {
      const view = createTableView(width, height, undefined, 'overview', 0, 0, width <= 700 ? 70 : 55, reserved);
      for (const x of [0, TABLE_SIZE]) for (const y of [0, TABLE_SIZE]) {
        const point = projectPoint(view, { x, y, z: 0 });
        expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(width - reserved);
        expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(height);
      }
    }
  });

  it('moves the view closer to a top view when leaning', () => {
    for (const seat of Object.keys(SEAT_PLACEMENT) as SeatPosition[]) {
      const normal = createTableView(1400, 900, seat, 'seat');
      const leaning = createTableView(1400, 900, seat, 'seat', 0, 0, 55, 0, 1);
      expect(leaning.eye.z).toBeGreaterThan(normal.eye.z);
      expect(leaning.forward.z).toBeLessThan(normal.forward.z);
    }
  });

  it('contains the entire rotated or upright card at every drag boundary', () => {
    for (const tapped of [false, true]) for (const x of [-100, 50, 200]) for (const y of [-100, 50, 200]) {
      const position = clampCardPosition(x, y, tapped);
      const halfWidth = (tapped ? CARD_SIZE.height : CARD_SIZE.width) / 2;
      const halfHeight = (tapped ? CARD_SIZE.width : CARD_SIZE.height) / 2;
      expect(position.x / 100 * CARD_AREA.width - halfWidth).toBeGreaterThanOrEqual(1.99);
      expect(position.x / 100 * CARD_AREA.width + halfWidth).toBeLessThanOrEqual(CARD_AREA.width - 1.99);
      expect(position.y / 100 * CARD_AREA.height - halfHeight).toBeGreaterThanOrEqual(1.99);
      expect(position.y / 100 * CARD_AREA.height + halfHeight).toBeLessThanOrEqual(CARD_AREA.height - 1.99);
    }
  });

  it('keeps mats and external zones separated across all four places', () => {
    const rectangles: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
    for (const seat of Object.keys(SEAT_PLACEMENT) as SeatPosition[]) {
      const local = [{ x: 0, y: 0, width: MAT_WIDTH, height: MAT_HEIGHT },
        ...[0, 1, 2].map(index => ({ x: -ZONE_GAP - CARD_SIZE.width, y: index * ZONE_STEP, ...CARD_SIZE })),
        ...[0, 1].map(index => ({ x: MAT_WIDTH + ZONE_GAP, y: index * ZONE_STEP, ...CARD_SIZE }))];
      for (const rect of local) {
        const points = [worldPoint(seat, rect.x, rect.y), worldPoint(seat, rect.x + rect.width, rect.y + rect.height)];
        const world = { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
        expect(world.minX).toBeGreaterThanOrEqual(0); expect(world.maxX).toBeLessThanOrEqual(TABLE_SIZE);
        expect(world.minY).toBeGreaterThanOrEqual(0); expect(world.maxY).toBeLessThanOrEqual(TABLE_SIZE);
        for (const other of rectangles) expect(world.minX >= other.maxX - 0.01 || world.maxX <= other.minX + 0.01 || world.minY >= other.maxY - 0.01 || world.maxY <= other.minY + 0.01).toBe(true);
        rectangles.push(world);
      }
    }
  });

  it('keeps the local mat projection reversible on a narrow viewport', () => {
    const view = createTableView(390, 799, 'southWest', 'seat', 0, 0, 70);
    const screen = projectPoint(view, worldPoint('southWest', 340, 190));
    const local = screenToMat(view, screen.x, screen.y, 'southWest');
    expect(view.centerX).toBe(195);
    expect(local?.x).toBeCloseTo(340, 5);
    expect(local?.y).toBeCloseTo(190, 5);
  });

  it('maps pointer gestures back to the same shared table point for all seats and camera views', () => {
    for (const seatId of Object.keys(SEAT_PLACEMENT) as SeatPosition[]) for (const mode of ['seat', 'overview'] as const) {
      const view = createTableView(390, 799, seatId, mode, 12, 6, 64, 0, .5);
      const world = { x: SEAT_PLACEMENT[seatId].x + 73, y: SEAT_PLACEMENT[seatId].y - 108, z: 0 };
      const screen = projectPoint(view, world);
      const actual = screenToTable(view, screen.x, screen.y);
      expect(actual?.x).toBeCloseTo(world.x, 5);
      expect(actual?.y).toBeCloseTo(world.y, 5);
    }
  });
});
