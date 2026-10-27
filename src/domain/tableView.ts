export const TABLE_SIZE = 2000;
export const MAT_WIDTH = 816;
export const MAT_HEIGHT = 456;
export const CARD_SIZE = { width: 84, height: 118 } as const;
export const ZONE_GAP = 16;
export const ZONE_STEP = 136;
export const FOV_LIMITS = { min: 25, max: 70 } as const;
export const CAMERA_PITCH_LIMITS = { min: -18, max: 8 } as const;
export function clampCameraPitch(pitch: number): number { return Math.max(CAMERA_PITCH_LIMITS.min, Math.min(CAMERA_PITCH_LIMITS.max, pitch)); }
// Keep the field close to the mat edges while clearing the header and command row.
export const CARD_AREA = { left: 10, top: 64, width: MAT_WIDTH - 20, height: MAT_HEIGHT - 74 } as const;

export const SEAT_PLACEMENT = {
  northWest: { x: 1000, y: 260, angle: 180 },
  northEast: { x: 1740, y: 1000, angle: -90 },
  southEast: { x: 1000, y: 1740, angle: 0 },
  southWest: { x: 260, y: 1000, angle: 90 },
} as const;
export type SeatPosition = keyof typeof SEAT_PLACEMENT;
export type ViewMode = 'seat' | 'overview';
type Vec3 = { x: number; y: number; z: number };
export type TableView = { eye: Vec3; right: Vec3; down: Vec3; forward: Vec3; perspective: number; centerX: number; centerY: number; transform: string };

const up = { x: 0, y: 0, z: 1 };
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (v: Vec3): Vec3 => { const length = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / length, y: v.y / length, z: v.z / length }; };
const scale = (v: Vec3, amount: number): Vec3 => ({ x: v.x * amount, y: v.y * amount, z: v.z * amount });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export function createTableView(width: number, height: number, seatId: SeatPosition | undefined, mode: ViewMode, yaw = 0, pitch = 0, fov = 55, reservedRight = 0, lean = 0): TableView {
  const centerX = (width - reservedRight) / 2;
  const centerY = height / 2;
  const perspective = height / (2 * Math.tan(Math.max(FOV_LIMITS.min, Math.min(FOV_LIMITS.max, fov)) * Math.PI / 360));
  const center = TABLE_SIZE / 2;
  const seat = seatId ? SEAT_PLACEMENT[seatId] : undefined;
  const outward = seat ? normalize({ x: seat.x - center, y: seat.y - center, z: 0 }) : { x: 0, y: 1, z: 0 };
  const inclination = Math.max(0, Math.min(1, lean));
  // Leaning translates the view toward the opponents. Moving the eye and look
  // target together keeps the framing close instead of fitting the whole table.
  const distance = (width <= 700 ? 1520 : 1160) - 900 * inclination;
  // Keep the overview fit independent of FOV, so zooming still works after resetting it.
  const defaultFov = width <= 700 ? 70 : 55;
  // Include the raised hands beyond the outer playmat edges in the overview.
  const overviewHeight = (TABLE_SIZE + 600) / (2 * Math.tan(defaultFov * Math.PI / 360)) * Math.max(1, height / Math.max(1, width - reservedRight));
  const eye = mode === 'overview' || !seat
    ? { x: center, y: center, z: overviewHeight }
    : { x: center + outward.x * distance, y: center + outward.y * distance, z: 900 + 250 * inclination };
  const target = mode === 'overview' || !seat
    ? { x: center, y: center, z: 0 }
    : { x: center + outward.x * (450 - 900 * inclination), y: center + outward.y * (450 - 900 * inclination), z: 0 };
  const baseForward = normalize(subtract(target, eye));
  const baseRight = mode === 'overview' || !seat ? { x: 1, y: 0, z: 0 } : normalize(cross(up, baseForward));
  const forward = mode === 'overview' || !seat ? baseForward : normalize(add(add(baseForward, scale(baseRight, Math.tan(yaw * Math.PI / 180))), scale(up, Math.tan(pitch * Math.PI / 180))));
  const right = mode === 'overview' || !seat ? baseRight : normalize(cross(up, forward));
  const down = normalize(cross(right, forward));
  const back = scale(forward, -1);
  const matrix = [right.x, down.x, back.x, 0, right.y, down.y, back.y, 0, right.z, down.z, back.z, 0,
    centerX - dot(right, eye), centerY - dot(down, eye), perspective - dot(back, eye), 1];
  return { eye, right, down, forward, perspective, centerX, centerY, transform: `matrix3d(${matrix.join(',')})` };
}

export function projectPoint(view: TableView, point: Vec3): { x: number; y: number } {
  const relative = subtract(point, view.eye);
  const distance = dot(relative, view.forward);
  const factor = view.perspective / distance;
  return { x: view.centerX + dot(relative, view.right) * factor, y: view.centerY + dot(relative, view.down) * factor };
}

/** Intersect a screen position with the tabletop plane in shared table coordinates. */
export function screenToTable(view: TableView, screenX: number, screenY: number): { x: number; y: number } | undefined {
  const ray = add(view.forward, add(scale(view.right, (screenX - view.centerX) / view.perspective), scale(view.down, (screenY - view.centerY) / view.perspective)));
  if (Math.abs(ray.z) < 1e-6) return undefined;
  const distance = -view.eye.z / ray.z;
  if (distance <= 0) return undefined;
  const world = add(view.eye, scale(ray, distance));
  return { x: world.x, y: world.y };
}

export function screenToMat(view: TableView, screenX: number, screenY: number, seatId: SeatPosition): { x: number; y: number } | undefined {
  const ray = add(view.forward, add(scale(view.right, (screenX - view.centerX) / view.perspective), scale(view.down, (screenY - view.centerY) / view.perspective)));
  if (Math.abs(ray.z) < 1e-6) return undefined;
  const distance = -view.eye.z / ray.z;
  if (distance <= 0) return undefined;
  const world = add(view.eye, scale(ray, distance));
  const seat = SEAT_PLACEMENT[seatId];
  const angle = seat.angle * Math.PI / 180;
  const dx = world.x - seat.x; const dy = world.y - seat.y;
  return { x: MAT_WIDTH / 2 + dx * Math.cos(angle) + dy * Math.sin(angle), y: MAT_HEIGHT / 2 - dx * Math.sin(angle) + dy * Math.cos(angle) };
}

export function clampCardPosition(x: number, y: number, tapped = false): { x: number; y: number } {
  const halfWidth = (tapped ? CARD_SIZE.height : CARD_SIZE.width) / 2 + 2;
  const halfHeight = (tapped ? CARD_SIZE.width : CARD_SIZE.height) / 2 + 2;
  const minX = halfWidth / CARD_AREA.width * 100;
  const minY = halfHeight / CARD_AREA.height * 100;
  return { x: Math.min(100 - minX, Math.max(minX, x)), y: Math.min(100 - minY, Math.max(minY, y)) };
}

export function screenToCardPosition(view: TableView, screenX: number, screenY: number, seatId: SeatPosition, tapped = false, offset = { x: 0, y: 0 }): { x: number; y: number } | undefined {
  const point = screenToMat(view, screenX, screenY, seatId);
  if (!point) return undefined;
  return clampCardPosition((point.x - offset.x - CARD_AREA.left) / CARD_AREA.width * 100, (point.y - offset.y - CARD_AREA.top) / CARD_AREA.height * 100, tapped);
}
