// One day of weather at the farm (types only, so the engine can refer to it without importing the fetch code).
export interface WeatherDay {
  date: string; // YYYY-MM-DD
  tempMax: number | null; // °C
  tempMin: number | null;
  humidity: number | null; // % daily mean
  rainMm: number | null;
  source: string; // "open-meteo archive" | "open-meteo forecast"
}
