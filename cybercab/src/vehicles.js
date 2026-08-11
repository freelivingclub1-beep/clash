/**
 * Vehicle registry.
 *
 * Each entry is (a) the hard dimensions of the car, (b) a `asset` slot naming a
 * real glTF file and how to interpret its meshes, and (c) a `surface` table of
 * curves used to generate a stand-in body when no asset is present.
 *
 * The generated body is a PLACEHOLDER, and the app labels it as one. It exists
 * so the configurator is testable and so option logic can be developed without
 * assets. Point `asset.url` at a real GLB and the loader takes over completely
 * -- nothing else in the app changes, because everything downstream addresses
 * the car through the roles in `asset.roles`, not through geometry it made.
 *
 * Dimensions are real published figures in metres; the option catalogue,
 * pricing and performance numbers are illustrative. Unofficial demo, not
 * affiliated with or endorsed by Tesla.
 */

export const VEHICLES = [
  {
    id: 'model3',
    name: 'Model 3',
    blurb: 'Sedan',
    dims: {
      front: 2.36,
      rear: -2.36,
      sill: 0.3,
      axleFront: 1.44,
      axleRear: -1.44,
      trackHalf: 0.87,
      archRadius: 0.47,
      rideHeight: 0.14,
    },
    asset: {
      // Drop a real Model 3 glTF here. See models/README.md for the contract.
      url: null,
      scaleToLength: 4.72,
      roles: {
        paint: ['body', 'carpaint', 'paint'],
        glass: ['glass', 'window', 'windshield'],
        chrome: ['chrome', 'trim', 'brightwork'],
        dark: ['rubber', 'plastic', 'cladding', 'grille'],
        wheel: ['wheel', 'rim', 'tyre', 'tire'],
        interior: ['interior', 'seat', 'dash'],
      },
    },
    surface: {
      roofline: [
        [-2.36, 1.02], [-2.1, 1.08], [-1.85, 1.11], [-1.5, 1.19], [-1.05, 1.32],
        [-0.6, 1.42], [-0.15, 1.44], [0.25, 1.4], [0.7, 1.24], [1.15, 1.0],
        [1.6, 0.9], [2.05, 0.8], [2.36, 0.71],
      ],
      halfWidth: [
        [-2.36, 0.7], [-2.1, 0.85], [-1.7, 0.92], [-0.9, 0.955], [0, 0.965],
        [0.8, 0.955], [1.6, 0.9], [2.05, 0.82], [2.36, 0.63],
      ],
      boxiness: [
        [-2.36, 2.6], [-1.7, 3.2], [-0.5, 3.5], [0.6, 3.3], [1.6, 2.8], [2.36, 2.5],
      ],
      // Model 3 has a full glass roof, so the canopy runs the length of the cabin.
      glassDepth: [
        [-1.86, -0.1], [-1.7, 0.06], [-1.5, 0.3], [-1.1, 0.42], [-0.5, 0.44],
        [0.2, 0.42], [0.6, 0.3], [0.86, 0.08], [1.02, -0.1],
      ],
      claddingLine: [
        [-2.36, 0.5], [-2.15, 0.4], [-1.8, 0.34], [0, 0.34], [1.8, 0.34],
        [2.15, 0.4], [2.36, 0.52],
      ],
      noseZone: 0.2,
      tailZone: 0.18,
      lightBar: { front: [0.62, 0.72], rear: [0.92, 1.0] },
    },
    trims: [
      { id: 'rwd', name: 'Rear-Wheel Drive', price: 42490, range: 272, topSpeed: 125, zeroToSixty: 5.8 },
      { id: 'lr', name: 'Long Range All-Wheel Drive', price: 49990, range: 341, topSpeed: 125, zeroToSixty: 4.2 },
      { id: 'perf', name: 'Performance All-Wheel Drive', price: 55990, range: 296, topSpeed: 163, zeroToSixty: 2.9 },
    ],
  },

  {
    id: 'modely',
    name: 'Model Y',
    blurb: 'Crossover',
    dims: {
      front: 2.375,
      rear: -2.375,
      sill: 0.36,
      axleFront: 1.445,
      axleRear: -1.445,
      trackHalf: 0.89,
      archRadius: 0.5,
      rideHeight: 0.167,
    },
    asset: {
      url: null,
      scaleToLength: 4.75,
      roles: {
        paint: ['body', 'carpaint', 'paint'],
        glass: ['glass', 'window', 'windshield'],
        chrome: ['chrome', 'trim', 'brightwork'],
        dark: ['rubber', 'plastic', 'cladding', 'grille'],
        wheel: ['wheel', 'rim', 'tyre', 'tire'],
        interior: ['interior', 'seat', 'dash'],
      },
    },
    surface: {
      // Taller and more upright everywhere: the roof peak is 16cm higher than
      // the Model 3's and holds flat far longer before the hatch drops away.
      roofline: [
        [-2.375, 1.0], [-2.1, 1.14], [-1.8, 1.31], [-1.4, 1.48], [-0.9, 1.58],
        [-0.3, 1.61], [0.2, 1.56], [0.7, 1.36], [1.15, 1.11], [1.6, 1.0],
        [2.0, 0.89], [2.375, 0.79],
      ],
      halfWidth: [
        [-2.375, 0.74], [-2.1, 0.88], [-1.7, 0.95], [-0.9, 0.985], [0, 0.99],
        [0.8, 0.985], [1.6, 0.93], [2.05, 0.85], [2.375, 0.66],
      ],
      boxiness: [
        [-2.375, 2.9], [-1.7, 3.7], [-0.5, 4.1], [0.6, 3.8], [1.6, 3.1], [2.375, 2.7],
      ],
      glassDepth: [
        [-1.92, -0.1], [-1.76, 0.08], [-1.5, 0.34], [-1.1, 0.46], [-0.5, 0.48],
        [0.2, 0.46], [0.62, 0.32], [0.88, 0.08], [1.04, -0.1],
      ],
      claddingLine: [
        [-2.375, 0.58], [-2.15, 0.48], [-1.8, 0.42], [0, 0.42], [1.8, 0.42],
        [2.15, 0.48], [2.375, 0.6],
      ],
      noseZone: 0.2,
      tailZone: 0.18,
      lightBar: { front: [0.68, 0.79], rear: [1.0, 1.09] },
    },
    trims: [
      { id: 'rwd', name: 'Rear-Wheel Drive', price: 44990, range: 260, topSpeed: 135, zeroToSixty: 5.9 },
      { id: 'lr', name: 'Long Range All-Wheel Drive', price: 48990, range: 320, topSpeed: 135, zeroToSixty: 4.8 },
      { id: 'perf', name: 'Performance All-Wheel Drive', price: 53490, range: 277, topSpeed: 155, zeroToSixty: 3.5 },
    ],
  },

  {
    id: 'cybercab',
    name: 'Cybercab',
    blurb: 'Two-seat robotaxi',
    dims: {
      front: 2.0,
      rear: -2.0,
      sill: 0.3,
      axleFront: 1.36,
      axleRear: -1.34,
      trackHalf: 0.9,
      archRadius: 0.46,
      rideHeight: 0.14,
    },
    asset: {
      url: null,
      scaleToLength: 4.0,
      roles: {
        paint: ['body', 'carpaint', 'paint'],
        glass: ['glass', 'window', 'canopy'],
        chrome: ['chrome', 'trim'],
        dark: ['rubber', 'plastic', 'cladding'],
        wheel: ['wheel', 'rim', 'tyre', 'tire'],
        interior: ['interior', 'seat', 'dash'],
      },
    },
    surface: {
      roofline: [
        [-2.0, 1.04], [-1.86, 1.09], [-1.55, 1.19], [-1.15, 1.29], [-0.65, 1.37],
        [-0.2, 1.42], [0.2, 1.42], [0.55, 1.34], [0.9, 1.19], [1.25, 1.06],
        [1.6, 0.99], [1.85, 0.96], [2.0, 0.92],
      ],
      halfWidth: [
        [-2.0, 0.79], [-1.84, 0.87], [-1.5, 0.92], [-0.9, 0.955], [0, 0.97],
        [0.9, 0.955], [1.42, 0.92], [1.8, 0.85], [2.0, 0.76],
      ],
      boxiness: [
        [-2.0, 3.0], [-1.6, 3.6], [-0.6, 4.0], [0.4, 3.8], [1.3, 3.1], [2.0, 2.6],
      ],
      glassDepth: [
        [-1.74, -0.1], [-1.6, 0.04], [-1.38, 0.26], [-1.0, 0.4], [-0.45, 0.44],
        [0.22, 0.44], [0.66, 0.38], [0.96, 0.24], [1.18, 0.08], [1.4, -0.1],
      ],
      claddingLine: [
        [-2.0, 0.54], [-1.86, 0.44], [-1.5, 0.37], [0, 0.37], [1.5, 0.37],
        [1.86, 0.44], [2.0, 0.56],
      ],
      noseZone: 0.17,
      tailZone: 0.13,
      lightBar: { front: [0.66, 0.73], rear: [0.78, 0.85] },
    },
    trims: [
      { id: 'rwd', name: 'Rear-Wheel Drive', price: 17490, range: 300, topSpeed: 110, zeroToSixty: 6.9 },
      { id: 'awd', name: 'Dual Motor All-Wheel Drive', price: 22490, range: 285, topSpeed: 125, zeroToSixty: 4.6 },
    ],
  },
];

export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
