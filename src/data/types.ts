// F1 live timing topics, as F1's feed and archive build them up (merged and decoded). Only the fields Pit Wall reads are typed; the feed sends more.

export interface SessionInfo {
  Key?: number;
  Name?: string; // "Practice 3", "Qualifying", "Sprint", "Race"
  Type?: string; // "Practice" | "Qualifying" | "Race"
  Path?: string;
  StartDate?: string;
  GmtOffset?: string;
  Meeting?: {
    Name?: string;
    OfficialName?: string;
    Location?: string;
    Country?: { Code?: string; Name?: string };
    Circuit?: { Key?: number; ShortName?: string };
  };
}

export interface DriverInfo {
  RacingNumber: string;
  Tla: string;
  BroadcastName?: string;
  FullName?: string;
  TeamName?: string;
  TeamColour?: string; // hex without '#'
  Line?: number;
  HeadshotUrl?: string;
}

export interface TimedValue {
  Value?: string;
  PersonalFastest?: boolean;
  OverallFastest?: boolean;
  Status?: number;
}

export interface SectorTiming extends TimedValue {
  PreviousValue?: string;
  Segments?: { Status: number }[];
  Stopped?: boolean;
}

export interface TimingLine {
  RacingNumber?: string;
  Line?: number;
  Position?: string;
  ShowPosition?: boolean;
  GapToLeader?: string;
  IntervalToPositionAhead?: { Value?: string; Catching?: boolean };
  TimeDiffToFastest?: string;
  TimeDiffToPositionAhead?: string;
  LastLapTime?: TimedValue;
  BestLapTime?: { Value?: string; Lap?: number };
  BestLapTimes?: { Value?: string; Lap?: number }[]; // qualifying, one per part
  Stats?: { TimeDiffToFastest?: string; TimeDiffToPositionAhead?: string }[]; // qualifying
  Sectors?: SectorTiming[];
  Speeds?: Partial<Record<"I1" | "I2" | "FL" | "ST", TimedValue>>;
  NumberOfLaps?: number;
  NumberOfPitStops?: number;
  InPit?: boolean;
  PitOut?: boolean;
  Retired?: boolean;
  Stopped?: boolean;
  KnockedOut?: boolean;
  Cutoff?: boolean;
}

export interface TimingData {
  Lines?: Record<string, TimingLine>;
  SessionPart?: number;
  Withheld?: boolean;
}

export interface Stint {
  Compound?: string; // SOFT | MEDIUM | HARD | INTERMEDIATE | WET | UNKNOWN
  New?: string; // "true" | "false"
  TotalLaps?: number;
  StartLaps?: number;
  LapTime?: string;
  LapNumber?: number;
}

export interface TimingAppData {
  Lines?: Record<string, { RacingNumber?: string; Line?: number; Stints?: Stint[] }>;
}

export interface TimingStats {
  Lines?: Record<
    string,
    {
      RacingNumber?: string;
      PersonalBestLapTime?: { Value?: string; Lap?: number; Position?: number };
      BestSectors?: { Value?: string; Position?: number }[];
      BestSpeeds?: Partial<Record<"I1" | "I2" | "FL" | "ST", { Value?: string; Position?: number }>>;
    }
  >;
  SessionType?: string;
}

export interface RaceControlMessage {
  Utc: string;
  Lap?: number;
  Category?: string; // Flag | Other | Drs | SafetyCar | CarEvent
  SubCategory?: string;
  Message: string;
  Flag?: string; // GREEN | YELLOW | DOUBLE YELLOW | RED | BLUE | CHEQUERED | CLEAR
  Scope?: string; // Track | Sector | Driver
  Sector?: number;
  RacingNumber?: string;
  Status?: string;
}

export interface Weather {
  AirTemp?: string;
  TrackTemp?: string;
  Humidity?: string;
  Pressure?: string;
  Rainfall?: string;
  WindDirection?: string;
  WindSpeed?: string;
}

export interface PositionFrame {
  Timestamp: string;
  Entries: Record<string, { Status?: string; X: number; Y: number; Z: number }>;
}

export interface CarDataFrame {
  Utc: string;
  // Channels: 0 rpm, 2 speed, 3 gear, 4 throttle, 5 brake
  Cars: Record<string, { Channels: Record<string, number> }>;
}

export interface LiveState {
  SessionInfo?: SessionInfo;
  SessionStatus?: { Status?: string };
  TrackStatus?: { Status?: string; Message?: string };
  ExtrapolatedClock?: { Utc?: string; Remaining?: string; Extrapolating?: boolean };
  LapCount?: { CurrentLap?: number; TotalLaps?: number } | null;
  DriverList?: Record<string, DriverInfo>;
  TimingData?: TimingData;
  TimingAppData?: TimingAppData;
  TimingStats?: TimingStats;
  TopThree?: unknown;
  RaceControlMessages?: { Messages?: RaceControlMessage[] | Record<string, RaceControlMessage> };
  WeatherData?: Weather;
  WeatherDataSeries?: { Series?: { Timestamp: string; Weather: Weather }[] };
  TeamRadio?: { Captures?: { Utc: string; RacingNumber: string; Path: string }[] };
  /** Each entry lingers a few seconds after a stop, then the feed clears it */
  PitLaneTimeCollection?: { PitTimes?: Record<string, { RacingNumber?: string; Duration?: string; Lap?: string }> };
  Position?: { Position?: PositionFrame[] };
  CarData?: { Entries?: CarDataFrame[] };
  Heartbeat?: { Utc?: string };
  [topic: string]: unknown;
}

/** The board's clock: track time T matches system time S, and runs forward from there
 *  unless paused. Times are epoch milliseconds. Recordings carry MultiViewer's. */
export interface LiveClock {
  paused: boolean;
  systemTime: number;
  trackTime: number;
  liveTimingStartTime?: number;
}

export const TOPICS = [
  "SessionInfo",
  "SessionStatus",
  "TrackStatus",
  "ExtrapolatedClock",
  "LapCount",
  "DriverList",
  "TimingData",
  "TimingAppData",
  "TimingStats",
  "RaceControlMessages",
  "WeatherData",
  "WeatherDataSeries",
  "TeamRadio",
  "PitLaneTimeCollection",
  "Position",
  "CarData",
  "Heartbeat",
] as const;
