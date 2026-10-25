// Data for the pre-race brief (the drawer's right-hand tab): the weather forecast for
// the next race, from Open-Meteo (free, CORS-open, no key), located by a bundled table
// of circuit coordinates (circuits don't move). What's-at-stake and the circuit guide
// are built in the panel from the championship and circuit data already loaded.

import { useEffect, useState } from "react";

// Per race locality (lowercased): coordinates (for the weather forecast) and the Jolpica
// circuit id (for pit-stop history). Keyed by city because the schedule's own ids and the
// stored-circuit ids don't line up. Circuits don't move, so this is static.
interface Place {
  coords: [number, number];
  jolpica: string;
}
const CIRCUITS: Record<string, Place> = {
  melbourne: { coords: [-37.8497, 144.968], jolpica: "albert_park" },
  shanghai: { coords: [31.3389, 121.22], jolpica: "shanghai" },
  suzuka: { coords: [34.8431, 136.541], jolpica: "suzuka" },
  miami: { coords: [25.9581, -80.2389], jolpica: "miami" },
  montreal: { coords: [45.5, -73.5228], jolpica: "villeneuve" },
  "monte carlo": { coords: [43.7347, 7.42056], jolpica: "monaco" },
  monaco: { coords: [43.7347, 7.42056], jolpica: "monaco" },
  barcelona: { coords: [41.57, 2.26111], jolpica: "catalunya" },
  spielberg: { coords: [47.2197, 14.7647], jolpica: "red_bull_ring" },
  silverstone: { coords: [52.0786, -1.01694], jolpica: "silverstone" },
  spa: { coords: [50.4372, 5.97139], jolpica: "spa" },
  budapest: { coords: [47.5789, 19.2486], jolpica: "hungaroring" },
  zandvoort: { coords: [52.3888, 4.54092], jolpica: "zandvoort" },
  monza: { coords: [45.6156, 9.28111], jolpica: "monza" },
  madrid: { coords: [40.46528, -3.61528], jolpica: "madring" },
  baku: { coords: [40.3725, 49.8533], jolpica: "baku" },
  "kuala lumpur": { coords: [2.76083, 101.738], jolpica: "sepang" },
  "marina bay": { coords: [1.2914, 103.864], jolpica: "marina_bay" },
  singapore: { coords: [1.2914, 103.864], jolpica: "marina_bay" },
  austin: { coords: [30.1328, -97.6411], jolpica: "americas" },
  "mexico city": { coords: [19.4042, -99.0907], jolpica: "rodriguez" },
  "são paulo": { coords: [-23.7036, -46.6997], jolpica: "interlagos" },
  "sao paulo": { coords: [-23.7036, -46.6997], jolpica: "interlagos" },
  "las vegas": { coords: [36.1147, -115.173], jolpica: "vegas" },
  lusail: { coords: [25.49, 51.4542], jolpica: "losail" },
  "abu dhabi": { coords: [24.4672, 54.6031], jolpica: "yas_marina" },
};

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function placeFor(location: string | undefined): Place | null {
  if (!location) return null;
  const want = strip(location);
  for (const [k, v] of Object.entries(CIRCUITS)) if (strip(k) === want || want.includes(strip(k))) return v;
  return null;
}

export function coordsFor(location: string | undefined): [number, number] | null {
  return placeFor(location)?.coords ?? null;
}

export interface Weather {
  temp: number; // °C at the race hour
  rain: number; // precipitation probability %, max over the race window
  wind: number; // km/h
  dry: boolean;
}

const cache = new Map<string, Promise<Weather | null>>();

/** Forecast for a race: the hour nearest its start, and the worst rain chance across it */
function loadWeather(lat: number, lon: number, startMs: number): Promise<Weather | null> {
  const key = `${lat},${lon},${Math.round(startMs / 3_600_000)}`;
  let p = cache.get(key);
  if (!p) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      hourly: "temperature_2m,precipitation_probability,wind_speed_10m",
      wind_speed_unit: "kmh",
      forecast_days: "16",
    });
    p = fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
        return r.json();
      })
      .then((d: { hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; wind_speed_10m: number[] } }) => {
        const h = d.hourly;
        if (!h?.time?.length) return null;
        // Open-Meteo times are local-to-the-point without a zone; compare as UTC wall time
        const times = h.time.map((t) => Date.parse(t + "Z"));
        let i = 0;
        for (let j = 1; j < times.length; j++) if (Math.abs(times[j] - startMs) < Math.abs(times[i] - startMs)) i = j;
        if (Math.abs(times[i] - startMs) > 24 * 3_600_000) return null; // race is beyond the forecast
        // Worst rain chance over the ~2 hours of running
        const rain = Math.max(...[0, 1, 2].map((o) => h.precipitation_probability[i + o] ?? 0));
        return { temp: Math.round(h.temperature_2m[i]), rain, wind: Math.round(h.wind_speed_10m[i]), dry: rain < 40 };
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

/** Weather for a race start (ms), or null while loading / unavailable */
export function useRaceWeather(location: string | undefined, startMs: number | undefined): { weather: Weather | null; loading: boolean; unavailable: boolean } {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const coords = coordsFor(location);
  useEffect(() => {
    setWeather(null);
    if (!coords || !startMs) {
      setUnavailable(!coords);
      return;
    }
    let alive = true;
    setLoading(true);
    setUnavailable(false);
    loadWeather(coords[0], coords[1], startMs)
      .then((w) => {
        if (!alive) return;
        setWeather(w);
        setUnavailable(!w);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [coords?.[0], coords?.[1], startMs]);
  return { weather, loading, unavailable };
}

const JOLPI = import.meta.env.DEV ? "/jolpi" : "https://api.jolpi.ca/ergast/f1";

export interface Strategy {
  season: number; // the season the history is from
  stops: Record<number, number>; // stop count → how many drivers did it
  typical: number; // the most common stop count
  finishers: number;
  pitSeconds: number | null; // median pit-lane time loss per stop, from that race
}

const stratCache = new Map<string, Promise<Strategy | null>>();

/** A pit-stop duration, "23.763" or the rare "1:12.4", in seconds */
function pitDuration(s: string): number {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(s);
}

async function jget<T>(path: string): Promise<T | null> {
  const r = await fetch(`${JOLPI}/${path}`);
  if (!r.ok) return null;
  return r.json();
}

/** Typical stop count at a circuit, from its most recent race's pit stops (this year, else last) */
export function strategyFor(location: string | undefined): Promise<Strategy | null> {
  const place = placeFor(location);
  if (!place) return Promise.resolve(null);
  let p = stratCache.get(place.jolpica);
  if (!p) {
    p = (async () => {
      const year = new Date().getFullYear();
      for (const season of [year, year - 1]) {
        const res = await jget<{ MRData: { RaceTable: { Races: { round: string }[] } } }>(`${season}/circuits/${place.jolpica}/results.json?limit=1`);
        const round = res?.MRData.RaceTable.Races[0]?.round;
        if (!round) continue;
        const ps = await jget<{ MRData: { RaceTable: { Races: { PitStops: { driverId: string; duration: string }[] }[] } } }>(`${season}/${round}/pitstops.json?limit=500`);
        const pits = ps?.MRData.RaceTable.Races[0]?.PitStops;
        if (!pits?.length) continue;
        const perDriver = new Map<string, number>();
        for (const s of pits) perDriver.set(s.driverId, (perDriver.get(s.driverId) ?? 0) + 1);
        const stops: Record<number, number> = {};
        for (const n of perDriver.values()) stops[n] = (stops[n] ?? 0) + 1;
        const typical = Number(Object.entries(stops).sort((a, b) => b[1] - a[1])[0][0]);
        // Typical time lost in the pits: the median stop duration (robust to slow ones)
        const durs = pits.map((s) => pitDuration(s.duration)).filter((n) => n > 0).sort((a, b) => a - b);
        const pitSeconds = durs.length ? Math.round(durs[durs.length >> 1]) : null;
        return { season, stops, typical, finishers: perDriver.size, pitSeconds };
      }
      return null;
    })().catch(() => {
      stratCache.delete(place.jolpica);
      return null;
    });
    stratCache.set(place.jolpica, p);
  }
  return p;
}

export function useRaceStrategy(location: string | undefined): { strategy: Strategy | null; loading: boolean } {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStrategy(null);
    if (!location) return;
    let alive = true;
    setLoading(true);
    strategyFor(location)
      .then((s) => alive && setStrategy(s))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [location]);
  return { strategy, loading };
}

// Pirelli compound nomination per race. There's no official feed, so it's a small file
// in the repo (data/nominations.json) that Pit Wall fetches live from GitHub — editing
// it on main updates every copy without a release. Keep it current with
// scripts/update-nominations.mjs.
const NOMINATIONS_URL = "https://raw.githubusercontent.com/MarcusLai07/f1-pitwall/main/data/nominations.json";

export interface Nomination {
  hard: string;
  medium: string;
  soft: string;
}

let nominationsDoc: Promise<Record<string, Record<string, Nomination>>> | null = null;
function loadNominations() {
  nominationsDoc ??= fetch(NOMINATIONS_URL, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => {
      nominationsDoc = null;
      return {};
    });
  return nominationsDoc;
}

export function useNomination(season: number | undefined, location: string | undefined): Nomination | null {
  const [nom, setNom] = useState<Nomination | null>(null);
  useEffect(() => {
    setNom(null);
    if (!season || !location) return;
    let alive = true;
    loadNominations().then((doc) => {
      if (!alive) return;
      const byCity = doc[String(season)];
      if (!byCity) return;
      const want = strip(location);
      const hit = Object.entries(byCity).find(([city]) => strip(city) === want || want.includes(strip(city)));
      setNom(hit ? hit[1] : null);
    });
    return () => {
      alive = false;
    };
  }, [season, location]);
  return nom;
}
