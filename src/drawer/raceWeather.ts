// Data for the pre-race brief (the drawer's right-hand tab): the weather forecast for
// the next race, from Open-Meteo (free, CORS-open, no key), located by a bundled table
// of circuit coordinates (circuits don't move). What's-at-stake and the circuit guide
// are built in the panel from the championship and circuit data already loaded.

import { useEffect, useState } from "react";

// lat, lon by race locality (lowercased) — from Jolpica's circuit locations. Keyed by
// city because the schedule's own circuit ids and the stored-circuit ids don't line up.
const COORDS: Record<string, [number, number]> = {
  melbourne: [-37.8497, 144.968],
  shanghai: [31.3389, 121.22],
  suzuka: [34.8431, 136.541],
  miami: [25.9581, -80.2389],
  montreal: [45.5, -73.5228],
  "monte carlo": [43.7347, 7.42056],
  monaco: [43.7347, 7.42056],
  barcelona: [41.57, 2.26111],
  spielberg: [47.2197, 14.7647],
  silverstone: [52.0786, -1.01694],
  spa: [50.4372, 5.97139],
  budapest: [47.5789, 19.2486],
  zandvoort: [52.3888, 4.54092],
  monza: [45.6156, 9.28111],
  madrid: [40.46528, -3.61528],
  baku: [40.3725, 49.8533],
  "kuala lumpur": [2.76083, 101.738],
  "marina bay": [1.2914, 103.864],
  singapore: [1.2914, 103.864],
  austin: [30.1328, -97.6411],
  "mexico city": [19.4042, -99.0907],
  "são paulo": [-23.7036, -46.6997],
  "sao paulo": [-23.7036, -46.6997],
  "las vegas": [36.1147, -115.173],
  lusail: [25.49, 51.4542],
  "abu dhabi": [24.4672, 54.6031],
};

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function coordsFor(location: string | undefined): [number, number] | null {
  if (!location) return null;
  const want = strip(location);
  for (const [k, v] of Object.entries(COORDS)) if (strip(k) === want || want.includes(strip(k))) return v;
  return null;
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
