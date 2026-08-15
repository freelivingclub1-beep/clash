/**
 * Shared vocabulary for terrain, weather and time of day.
 *
 * The player sees at most eight facts about a course (§9). These types are the
 * full truth underneath those facts — segment ordering, severity and all.
 */

export const TERRAINS = ["flat", "rock", "mud", "sand", "snow", "ice", "scrub", "water"] as const;
export type Terrain = (typeof TERRAINS)[number];

export const TEMPERATURES = ["freezing", "cold", "mild", "warm", "hot"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const PRECIPITATION = ["dry", "rain", "sleet", "snowfall"] as const;
export type Precipitation = (typeof PRECIPITATION)[number];

export const WINDS = ["dead calm", "still", "breeze", "wind", "gale"] as const;
export type Wind = (typeof WINDS)[number];

export const LIGHTS = ["dawn", "morning", "noon", "afternoon", "dusk", "night"] as const;
export type Light = (typeof LIGHTS)[number];

export const AIRS = ["clear", "humid", "dust", "smoke", "thin"] as const;
export type Air = (typeof AIRS)[number];

export type Weather = {
  readonly temperature: Temperature;
  readonly precipitation: Precipitation;
  readonly wind: Wind;
  readonly windFrom: "north" | "south" | "east" | "west";
  readonly light: Light;
  readonly air: Air;
};

/** Ambient heat load in the sim's arbitrary units. */
export const TEMPERATURE_LOAD: Record<Temperature, number> = {
  freezing: -1.0,
  cold: -0.5,
  mild: 0,
  warm: 0.6,
  hot: 1.2,
};

export const WIND_FORCE: Record<Wind, number> = {
  "dead calm": 0,
  still: 0.1,
  breeze: 0.35,
  wind: 0.7,
  gale: 1.1,
};

export const DARKNESS: Record<Light, number> = {
  dawn: 0.35,
  morning: 0,
  noon: 0,
  afternoon: 0,
  dusk: 0.45,
  night: 0.9,
};

/** Dawn starts and high noon are the two moments that dazzle a Night-eye dog. */
export function isGlaring(light: Light): boolean {
  return light === "dawn" || light === "noon";
}
