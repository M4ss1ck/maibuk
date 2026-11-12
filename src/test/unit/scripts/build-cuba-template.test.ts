// @vitest-environment node
/**
 * The Cuba Template build script (#755): the pure steps that turn Natural
 * Earth's admin-1 provinces into the generated module. Every test feeds
 * hand-made rings, so none of them downloads the 40 MB source.
 */

import { describe, expect, it } from "vitest";
import type { MapPoint } from "../../../../plugins/maibuk-maps/maps";
import {
  buildCubaModule,
  buildCubaModuleData,
  buildTopology,
  type CubaFeature,
  selectProvinces,
  simplifyArc,
} from "../../../../scripts/build-cuba-template";

/** A closed square ring, counter-clockwise, with its first point repeated at the end. */
function square(left: number, bottom: number, size = 1): MapPoint[] {
  return [
    [left, bottom],
    [left + size, bottom],
    [left + size, bottom + size],
    [left, bottom + size],
    [left, bottom],
  ];
}

function polygonFeature(name: string, iso: string, ring: MapPoint[]): CubaFeature {
  return {
    properties: { adm0_a3: "CUB", name, iso_3166_2: iso },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function multiPolygonFeature(name: string, iso: string, rings: MapPoint[][]): CubaFeature {
  return {
    properties: { adm0_a3: "CUB", name, iso_3166_2: iso },
    geometry: { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) },
  };
}

const NAMES = [
  "Pinar del Río",
  "Artemisa",
  "Ciudad de la Habana",
  "Mayabeque",
  "Matanzas",
  "Villa Clara",
  "Cienfuegos",
  "Sancti Spíritus",
  "Ciego de Ávila",
  "Camagüey",
  "Las Tunas",
  "Granma",
  "Holguín",
  "Santiago de Cuba",
  "Guantánamo",
  "Isla de la Juventud",
];

const ISOS = [
  "CU-01",
  "CU-15",
  "CU-03",
  "CU-16",
  "CU-04",
  "CU-05",
  "CU-06",
  "CU-07",
  "CU-08",
  "CU-09",
  "CU-10",
  "CU-12",
  "CU-11",
  "CU-13",
  "CU-14",
  "CU-99",
];

/** Sixteen disjoint Cuban provinces, plus a feature from another country the selector must ignore. */
function sourceFeatures(): CubaFeature[] {
  const features = NAMES.map((name, index) =>
    polygonFeature(name, ISOS[index], square(index * 2, 20))
  );
  features.push({
    properties: { adm0_a3: "USA", name: "Florida", iso_3166_2: "US-FL" },
    geometry: { type: "Polygon", coordinates: [square(40, 20)] },
  });
  return features;
}

describe("buildTopology()", () => {
  it("cuts a border two provinces share into one arc, joined onto the coast ring", () => {
    const topology = buildTopology([square(0, 0), square(1, 0)]);

    expect(topology.borders).toHaveLength(1);
    const [border] = topology.borders;
    expect(border).toHaveLength(2);

    expect(topology.coasts).toHaveLength(1);
    const coast = topology.coasts[0];
    expect(coast).toHaveLength(6);
    for (const end of [border[0], border[border.length - 1]]) {
      expect(coast.some((point) => point[0] === end[0] && point[1] === end[1])).toBe(true);
    }
  });

  it("keeps a T junction as an end of each of the three borders", () => {
    const topLeft: MapPoint[] = [
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0, 0.5],
      [0, 0],
    ];
    const topRight: MapPoint[] = [
      [1, 0],
      [2, 0],
      [2, 0.5],
      [1, 0.5],
      [1, 0],
    ];
    const bottom: MapPoint[] = [
      [0, 0.5],
      [1, 0.5],
      [2, 0.5],
      [2, 1],
      [0, 1],
      [0, 0.5],
    ];
    const topology = buildTopology([topLeft, topRight, bottom]);

    expect(topology.borders).toHaveLength(3);
    const junction: MapPoint = [1, 0.5];
    const farEnds = topology.borders.map((border) =>
      border[0][0] === junction[0] && border[0][1] === junction[1]
        ? border[border.length - 1]
        : border[0]
    );
    expect(farEnds).toEqual(
      expect.arrayContaining([
        [1, 0],
        [0, 0.5],
        [2, 0.5],
      ])
    );
    for (const border of topology.borders) {
      expect(border.some((point) => point[0] === junction[0] && point[1] === junction[1])).toBe(
        true
      );
    }
  });

  it("simplifies a junction-free closed coast ring and keeps it closed", () => {
    // One province on an island no neighbour touches: a square whose edges are
    // split by midpoints, so it arrives as a closed arc with no junction to cut.
    const ring: MapPoint[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
      [0, 0],
    ];

    const topology = buildTopology([ring]);
    expect(topology.borders).toHaveLength(0);
    expect(topology.coastArcs).toHaveLength(1);
    const [arc] = topology.coastArcs;
    expect(arc[0]).toEqual(arc[arc.length - 1]);

    const data = buildCubaModuleData([{ iso: "CU-01", name: "Only", rings: [ring] }]);
    expect(data.coasts).toHaveLength(1);
    const [coast] = data.coasts;
    // Douglas-Peucker drops the midpoints and keeps the four corners.
    expect(coast.length).toBeLessThan(ring.length - 1);
    const xs = coast.map(([x]) => x);
    const ys = coast.map(([, y]) => y);
    for (const [x, y] of coast) {
      expect(x === Math.min(...xs) || x === Math.max(...xs)).toBe(true);
      expect(y === Math.min(...ys) || y === Math.max(...ys)).toBe(true);
    }
  });

  it("keeps the coast junction a border end after simplification and projection", () => {
    const provinces = [
      { iso: "CU-01", name: "West", rings: [square(0, 0, 1)] },
      { iso: "CU-02", name: "East", rings: [square(1, 0, 1)] },
    ];
    const data = buildCubaModuleData(provinces);

    expect(data.borders).toHaveLength(1);
    const coastPoints = data.coasts.flat();
    for (const end of [data.borders[0][0], data.borders[0][data.borders[0].length - 1]]) {
      expect(coastPoints.some((point) => point[0] === end[0] && point[1] === end[1])).toBe(true);
    }
  });
});

describe("simplifyArc()", () => {
  it("drops points within the tolerance but keeps both junction ends", () => {
    const arc: MapPoint[] = [
      [0, 0],
      [0.001, 0.0001],
      [0.002, -0.0001],
      [0.003, 0.0001],
      [0.02, 0],
    ];

    const simplified = simplifyArc(arc, 0.001);

    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified[simplified.length - 1]).toEqual([0.02, 0]);
    expect(simplified.length).toBeLessThan(arc.length);
  });

  it("keeps a point that gives the stretch its shape", () => {
    const corner: MapPoint[] = [
      [0, 0],
      [0.01, 0.01],
      [0.02, 0],
    ];

    expect(simplifyArc(corner, 0.001)).toEqual(corner);
  });
});

describe("selectProvinces()", () => {
  it("takes exactly the sixteen Cuba features and renames Ciudad de la Habana", () => {
    const provinces = selectProvinces(sourceFeatures());

    expect(provinces).toHaveLength(16);
    expect(provinces.map((province) => province.iso)).toEqual([...ISOS].sort());
    expect(provinces.find((province) => province.iso === "CU-03")?.name).toBe("La Habana");
    expect(provinces.find((province) => province.iso === "CU-01")?.name).toBe("Pinar del Río");
  });

  it("fails loudly when the source does not carry sixteen provinces", () => {
    const fifteen = sourceFeatures().filter((feature) => feature.properties.adm0_a3 === "CUB");
    expect(() => selectProvinces(fifteen.slice(0, 15))).toThrow(/16/);
  });

  it("keeps a polygon at least a tenth of the province's largest and drops smaller islets", () => {
    const features = sourceFeatures().filter((feature) => feature.properties.adm0_a3 === "CUB");
    const mainland = square(30, 20, 1);
    const cay = square(32, 20, 0.5);
    const islet = square(34, 20, 0.2);
    features[15] = multiPolygonFeature("Isla de la Juventud", "CU-99", [mainland, islet, cay]);

    const province = selectProvinces(features).find((entry) => entry.iso === "CU-99");

    expect(province?.rings).toHaveLength(2);
    expect(province?.rings[0]).toEqual(mainland);
    expect(province?.rings[1]).toEqual(cay);
  });
});

describe("buildCubaModule()", () => {
  it("writes the same bytes for the same source twice", () => {
    expect(buildCubaModule(sourceFeatures())).toBe(buildCubaModule(sourceFeatures()));
  });

  it("orders the output by iso code whatever order the source lists", () => {
    const reversed = [...sourceFeatures()].reverse();

    expect(buildCubaModule(reversed)).toBe(buildCubaModule(sourceFeatures()));
  });

  it("emits the generated header, its MapPoint import, and the three exports", () => {
    const module = buildCubaModule(sourceFeatures());

    expect(module).toContain("Do not edit by hand");
    expect(module).toContain('import type { MapPoint } from "./maps";');
    expect(module).toContain("export const CUBA_COASTS");
    expect(module).toContain("export const CUBA_BORDERS");
    expect(module).toContain("export const CUBA_PROVINCES");
    expect(module).toContain('{ name: "La Habana", point: [');
  });
});
