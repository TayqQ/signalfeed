import { describe, expect, it } from "vitest";
import { boundingBox, haversineKm } from "./distance";

const LEEDS = { lat: 53.7997, lon: -1.5492 };
const BRADFORD = { lat: 53.796, lon: -1.7594 };

/** Small seeded generator, so the random test is repeatable. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("haversineKm", () => {
  it("measures Leeds to Bradford at about 13 km", () => {
    expect(haversineKm(LEEDS, BRADFORD)).toBeGreaterThan(11);
    expect(haversineKm(LEEDS, BRADFORD)).toBeLessThan(15);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineKm(LEEDS, LEEDS)).toBe(0);
    expect(haversineKm(LEEDS, BRADFORD)).toBeCloseTo(
      haversineKm(BRADFORD, LEEDS),
      9,
    );
  });

  it("gives about 111 km for one degree of latitude", () => {
    const d = haversineKm({ lat: 50, lon: 0 }, { lat: 51, lon: 0 });
    expect(d).toBeGreaterThan(111);
    expect(d).toBeLessThan(111.4);
  });
});

describe("boundingBox", () => {
  it("is centred on the point", () => {
    const box = boundingBox(LEEDS, 25);
    expect(box.minLat).toBeLessThan(LEEDS.lat);
    expect(box.maxLat).toBeGreaterThan(LEEDS.lat);
    expect(box.minLon).toBeLessThan(LEEDS.lon);
    expect(box.maxLon).toBeGreaterThan(LEEDS.lon);
  });

  it("contains every point within the radius (fixed seed)", () => {
    const random = mulberry32(2025);
    let inside = 0;
    for (let i = 0; i < 400; i += 1) {
      const centre = {
        lat: 50 + random() * 10,
        lon: -7 + random() * 8,
      };
      const km = 5 + random() * 195;
      const box = boundingBox(centre, km);
      for (let j = 0; j < 50; j += 1) {
        const point = {
          lat: centre.lat + (random() - 0.5) * 6,
          lon: centre.lon + (random() - 0.5) * 10,
        };
        if (haversineKm(centre, point) <= km) {
          inside += 1;
          expect(point.lat).toBeGreaterThanOrEqual(box.minLat);
          expect(point.lat).toBeLessThanOrEqual(box.maxLat);
          expect(point.lon).toBeGreaterThanOrEqual(box.minLon);
          expect(point.lon).toBeLessThanOrEqual(box.maxLon);
        }
      }
    }
    expect(inside).toBeGreaterThan(500);
  });

  it("is not wasteful: the box is no more than twice the circle's width", () => {
    const box = boundingBox(LEEDS, 25);
    const heightKm = haversineKm(
      { lat: box.minLat, lon: LEEDS.lon },
      { lat: box.maxLat, lon: LEEDS.lon },
    );
    expect(heightKm).toBeCloseTo(50, 0);
  });

  it("covers every longitude near a pole", () => {
    const box = boundingBox({ lat: 89.9, lon: 0 }, 100);
    expect(box.minLon).toBe(-180);
    expect(box.maxLon).toBe(180);
  });
});
