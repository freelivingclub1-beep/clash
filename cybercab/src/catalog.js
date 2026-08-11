/**
 * The parts catalogue.
 *
 * Every option is data: an id, a price, whatever the renderer needs to draw it,
 * and a `focus` naming the camera preset that should be flown to when the user
 * opens that group. Adding a wheel brand is appending an object here.
 *
 * Brands are house names rather than real aftermarket companies -- inventing a
 * real manufacturer's catalogue and pricing would be putting words in their
 * mouth. Swap the `brand` and `name` strings for a real supplier's catalogue
 * and nothing else has to change.
 *
 * Prices are illustrative. Unofficial demo, not affiliated with Tesla.
 */

export const PAINTS = [
  { id: 'pearl-white', name: 'Pearl White Multi-Coat', price: 0, swatch: '#eeeeec', base: '#e7e7e5', metalness: 0.42, roughness: 0.3 },
  { id: 'stealth-grey', name: 'Stealth Grey', price: 0, swatch: '#4a4d50', base: '#42454a', metalness: 0.7, roughness: 0.36 },
  { id: 'diamond-black', name: 'Diamond Black', price: 1500, swatch: '#16181a', base: '#0f1113', metalness: 0.6, roughness: 0.22 },
  { id: 'deep-blue', name: 'Deep Blue Metallic', price: 1500, swatch: '#1d3a63', base: '#17325a', metalness: 0.8, roughness: 0.3 },
  { id: 'quicksilver', name: 'Quicksilver', price: 2000, swatch: '#a9adb2', base: '#9ba0a6', metalness: 0.95, roughness: 0.24 },
  { id: 'ultra-red', name: 'Ultra Red', price: 2500, swatch: '#9c1421', base: '#8e0f1c', metalness: 0.75, roughness: 0.26 },
  { id: 'gold', name: 'Signature Gold', price: 2500, swatch: '#b9a06a', base: '#b4995e', metalness: 0.85, roughness: 0.32 },
  { id: 'satin-olive', name: 'Satin Olive (wrap)', price: 3500, swatch: '#4b5340', base: '#454d3b', metalness: 0.25, roughness: 0.62 },
  { id: 'matte-graphite', name: 'Matte Graphite (wrap)', price: 3500, swatch: '#2c2f33', base: '#26292d', metalness: 0.2, roughness: 0.78 },
];

/**
 * Wheels carry their own geometry parameters, so switching one rebuilds the
 * arches around it. `style` selects the face drawing; `finish` is applied on
 * top, which is why the two are separate lists rather than one exploded list of
 * every combination.
 */
export const WHEELS = [
  { id: 'aero-18', brand: 'Tesla', name: '18" Aero', price: 0, style: 'aero', diameter: 18, radius: 0.343, width: 0.235, rangeDelta: 0 },
  { id: 'sport-19', brand: 'Tesla', name: '19" Sport', price: 1500, style: 'turbine', diameter: 19, radius: 0.353, width: 0.245, rangeDelta: -18 },
  { id: 'induction-20', brand: 'Tesla', name: '20" Induction', price: 2500, style: 'induction', diameter: 20, radius: 0.363, width: 0.255, rangeDelta: -26 },
  { id: 'arachnid-21', brand: 'Tesla', name: '21" Arachnid', price: 3500, style: 'arachnid', diameter: 21, radius: 0.373, width: 0.265, rangeDelta: -32 },
  { id: 'meshwork-20', brand: 'Halden', name: '20" Meshwork', price: 2800, style: 'mesh', diameter: 20, radius: 0.363, width: 0.26, rangeDelta: -24 },
  { id: 'vector-20', brand: 'Halden', name: '20" Vector', price: 3200, style: 'split', diameter: 20, radius: 0.363, width: 0.265, rangeDelta: -25 },
  { id: 'monoblock-21', brand: 'Orbit Forged', name: '21" Monoblock', price: 5400, style: 'concave', diameter: 21, radius: 0.373, width: 0.275, rangeDelta: -34 },
  { id: 'lattice-21', brand: 'Orbit Forged', name: '21" Lattice', price: 6200, style: 'lattice', diameter: 21, radius: 0.373, width: 0.275, rangeDelta: -36 },
  { id: 'dish-22', brand: 'Kessel', name: '22" Deep Dish', price: 7600, style: 'dish', diameter: 22, radius: 0.383, width: 0.285, rangeDelta: -44 },
];

export const WHEEL_FINISHES = [
  { id: 'silver', name: 'Silver', price: 0, swatch: '#b9bdc1', tint: '#b9bdc1', metalness: 0.9, roughness: 0.28 },
  { id: 'gloss-black', name: 'Gloss Black', price: 400, swatch: '#17191b', tint: '#2a2c2f', metalness: 0.85, roughness: 0.16 },
  { id: 'satin-black', name: 'Satin Black', price: 400, swatch: '#2b2d30', tint: '#3a3d41', metalness: 0.5, roughness: 0.55 },
  { id: 'machined', name: 'Machined Face', price: 700, swatch: '#d6d3cb', tint: '#ddd9d0', metalness: 1.0, roughness: 0.2 },
  { id: 'bronze', name: 'Satin Bronze', price: 900, swatch: '#8a6a3f', tint: '#9c7844', metalness: 0.85, roughness: 0.36 },
  { id: 'gunmetal', name: 'Gunmetal', price: 700, swatch: '#565b60', tint: '#63696f', metalness: 0.9, roughness: 0.3 },
];

/** Visible light transmission, so lower percentages are darker. */
export const TINTS = [
  { id: 'none', name: 'Factory Glass', price: 0, vlt: 78, swatch: '#c9d3da', opacity: 0.24, color: '#6f8493' },
  { id: 'vlt70', name: '70% Ceramic', price: 450, vlt: 70, swatch: '#9fb0bc', opacity: 0.36, color: '#4e6270' },
  { id: 'vlt50', name: '50% Ceramic', price: 550, vlt: 50, swatch: '#75858f', opacity: 0.52, color: '#38474f' },
  { id: 'vlt35', name: '35% Ceramic', price: 650, vlt: 35, swatch: '#4d585f', opacity: 0.68, color: '#242e33' },
  { id: 'vlt20', name: '20% Ceramic', price: 750, vlt: 20, swatch: '#31383d', opacity: 0.82, color: '#161c1f' },
  { id: 'vlt05', name: '5% Limo', price: 850, vlt: 5, swatch: '#17191b', opacity: 0.93, color: '#0a0c0d' },
];

/**
 * Aero parts are generated against the body outline at run time, so they fit
 * whichever car is loaded instead of being modelled per vehicle.
 */
export const FRONT_LIPS = [
  { id: 'none', name: 'None', price: 0, swatch: '#dfe3e7', part: null },
  { id: 'splitter', name: 'Front Splitter', price: 890, swatch: '#2a2c2e', part: { kind: 'frontLip', drop: 0.04, reach: 0.06 } },
  { id: 'deep-splitter', name: 'Deep Splitter', price: 1290, swatch: '#1b1d1f', part: { kind: 'frontLip', drop: 0.06, reach: 0.105 } },
];

export const REAR_LIPS = [
  { id: 'none', name: 'None', price: 0, swatch: '#dfe3e7', part: null },
  { id: 'ducktail', name: 'Ducktail Lip', price: 690, swatch: '#3a3d40', part: { kind: 'rearLip', rise: 0.055, reach: 0.06 } },
  { id: 'spoiler', name: 'Track Spoiler', price: 1190, swatch: '#26282a', part: { kind: 'rearLip', rise: 0.1, reach: 0.1 } },
  { id: 'wing', name: 'Pedestal Wing', price: 2400, swatch: '#151719', part: { kind: 'wing', rise: 0.24, chord: 0.2 } },
];

export const SKIRTS = [
  { id: 'none', name: 'None', price: 0, swatch: '#dfe3e7', part: null },
  { id: 'skirts', name: 'Side Skirts', price: 780, swatch: '#2a2c2e', part: { kind: 'skirt', drop: 0.055 } },
];

export const DIFFUSERS = [
  { id: 'none', name: 'None', price: 0, swatch: '#dfe3e7', part: null },
  { id: 'diffuser', name: 'Rear Diffuser', price: 950, swatch: '#1b1d1f', part: { kind: 'diffuser' } },
];

export const CALIPERS = [
  { id: 'stock', name: 'Factory', price: 0, swatch: '#6a6e72', color: '#5f6367' },
  { id: 'red', name: 'Racing Red', price: 1200, swatch: '#a51e22', color: '#a51e22' },
  { id: 'yellow', name: 'Signal Yellow', price: 1200, swatch: '#d8a410', color: '#d8a410' },
  { id: 'blue', name: 'Electric Blue', price: 1200, swatch: '#1d4ea8', color: '#1d4ea8' },
  { id: 'black', name: 'Gloss Black', price: 800, swatch: '#1a1c1e', color: '#1a1c1e' },
];

export const SUSPENSION = [
  { id: 'stock', name: 'Factory Height', price: 0, drop: 0 },
  { id: 'lowered', name: 'Lowering Springs (−25mm)', price: 1450, drop: 0.025 },
  { id: 'coilovers', name: 'Coilovers (−50mm)', price: 3200, drop: 0.05 },
];

export const TRIM_FINISH = [
  { id: 'chrome', name: 'Factory Chrome', price: 0, swatch: '#c3c7cb', color: '#b8bcc0', metalness: 1, roughness: 0.18 },
  { id: 'delete', name: 'Chrome Delete', price: 550, swatch: '#1a1c1e', color: '#17191b', metalness: 0.6, roughness: 0.4 },
  { id: 'carbon', name: 'Carbon Fibre', price: 1900, swatch: '#26292c', color: '#1e2124', metalness: 0.35, roughness: 0.3 },
];

export const INTERIORS = [
  { id: 'light', name: 'Light Ash', price: 0, swatch: '#d9d6cf', seat: '#bab6ad', trim: '#93908a' },
  { id: 'dark', name: 'All Black', price: 0, swatch: '#3a3c40', seat: '#303235', trim: '#212325' },
  { id: 'cream', name: 'Cream', price: 1000, swatch: '#e2d9c6', seat: '#cec5b1', trim: '#a49b88' },
];

export const GAS_SAVINGS = 5000;
export const PAYMENT_TABS = ['Cash', 'Lease', 'Finance'];

/**
 * The panel, as data. `focus` is the camera preset flown to when a group opens
 * -- this is what makes clicking "Wheels" put you at the wheel and clicking
 * "Paint" pull back to see the whole car.
 */
export const GROUPS = [
  { id: 'paint', title: 'Paint', kind: 'swatch', list: PAINTS, focus: 'hero' },
  { id: 'wheels', title: 'Wheels', kind: 'card', list: WHEELS, focus: 'wheel', grouped: true },
  { id: 'wheelFinish', title: 'Wheel Finish', kind: 'swatch', list: WHEEL_FINISHES, focus: 'wheel' },
  { id: 'calipers', title: 'Brake Calipers', kind: 'swatch', list: CALIPERS, focus: 'wheel' },
  { id: 'tint', title: 'Window Tint', kind: 'swatch', list: TINTS, focus: 'side' },
  { id: 'frontLip', title: 'Front Aero', kind: 'swatch', list: FRONT_LIPS, focus: 'front' },
  { id: 'skirts', title: 'Side Skirts', kind: 'swatch', list: SKIRTS, focus: 'side' },
  { id: 'rearLip', title: 'Rear Aero', kind: 'swatch', list: REAR_LIPS, focus: 'rear' },
  { id: 'diffuser', title: 'Diffuser', kind: 'swatch', list: DIFFUSERS, focus: 'rear' },
  { id: 'trimFinish', title: 'Exterior Trim', kind: 'swatch', list: TRIM_FINISH, focus: 'side' },
  { id: 'suspension', title: 'Suspension', kind: 'row', list: SUSPENSION, focus: 'side' },
  { id: 'interior', title: 'Interior', kind: 'swatch', list: INTERIORS, focus: 'cabin' },
];

const byId = (list, id) => list.find((o) => o.id === id) ?? list[0];

/** Which meshes a given option group actually changes -- drives rebuild scope. */
export const GROUP_IMPACT = {
  paint: 'material',
  tint: 'material',
  wheelFinish: 'material',
  calipers: 'material',
  trimFinish: 'material',
  wheels: 'wheels',
  suspension: 'transform',
  frontLip: 'parts',
  rearLip: 'parts',
  skirts: 'parts',
  diffuser: 'parts',
  interior: 'interior',
};

export function resolve(config) {
  const out = {};
  for (const group of GROUPS) out[group.id] = byId(group.list, config[group.id]);
  return out;
}

export function priceConfig(config, vehicle) {
  const trim = vehicle.trims.find((t) => t.id === config.trim) ?? vehicle.trims[0];
  const parts = resolve(config);

  const options = GROUPS.reduce((sum, g) => sum + (parts[g.id]?.price ?? 0), 0);
  const subtotal = trim.price + options;
  const savings = config.includeSavings ? GAS_SAVINGS : 0;

  return {
    trim,
    parts,
    options,
    subtotal,
    savings,
    total: subtotal - savings,
    specs: {
      range: Math.max(0, trim.range + (parts.wheels?.rangeDelta ?? 0)),
      topSpeed: trim.topSpeed,
      zeroToSixty: trim.zeroToSixty,
    },
  };
}

export const DEFAULT_CONFIG = {
  vehicle: 'model3',
  trim: 'lr',
  paint: 'pearl-white',
  wheels: 'induction-20',
  wheelFinish: 'gloss-black',
  calipers: 'stock',
  tint: 'vlt35',
  frontLip: 'none',
  rearLip: 'ducktail',
  skirts: 'none',
  diffuser: 'none',
  trimFinish: 'delete',
  suspension: 'stock',
  interior: 'dark',
  includeSavings: false,
  payment: 'Cash',
};

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
