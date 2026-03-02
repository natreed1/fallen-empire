import {
  WeatherEvent, WeatherEventType, GameNotification,
  WEATHER_DURATION_CYCLES, WEATHER_HARVEST_PENALTY,
  WEATHER_CHANCE_PER_CYCLE, WEATHER_MIN_CYCLE, WEATHER_COOLDOWN_CYCLES,
  WEATHER_DISPLAY,
  generateId,
} from '@/types/game';

/**
 * Determine whether a new weather disaster should strike this cycle.
 * Returns a new WeatherEvent if triggered, or null.
 */
export function rollForWeatherEvent(
  cycle: number,
  activeWeather: WeatherEvent | null,
  lastWeatherEndCycle: number,
): WeatherEvent | null {
  // No disasters in the first few cycles
  if (cycle < WEATHER_MIN_CYCLE) return null;

  // Don't stack — only one active disaster at a time
  if (activeWeather) return null;

  // Cooldown: require gap between events
  if (cycle - lastWeatherEndCycle < WEATHER_COOLDOWN_CYCLES) return null;

  // Roll the dice
  if (Math.random() > WEATHER_CHANCE_PER_CYCLE) return null;

  // Pick a random disaster type
  const types: WeatherEventType[] = ['typhoon', 'drought'];
  const type = types[Math.floor(Math.random() * types.length)];

  return {
    id: generateId('weather'),
    type,
    startCycle: cycle,
    duration: WEATHER_DURATION_CYCLES,
    harvestPenalty: WEATHER_HARVEST_PENALTY,
  };
}

/**
 * Tick the active weather event: decrement duration and return updated state.
 * Returns the updated event (or null if expired) plus any notifications.
 */
export function tickWeatherEvent(
  event: WeatherEvent | null,
  cycle: number,
): { event: WeatherEvent | null; endedCycle: number | null; notifications: GameNotification[] } {
  if (!event) return { event: null, endedCycle: null, notifications: [] };

  const remaining = event.duration - 1;

  if (remaining <= 0) {
    const display = WEATHER_DISPLAY[event.type];
    return {
      event: null,
      endedCycle: cycle,
      notifications: [{
        id: generateId('n'),
        turn: cycle,
        message: `The ${display.label.toLowerCase()} has passed. Harvests return to normal.`,
        type: 'success',
      }],
    };
  }

  return {
    event: { ...event, duration: remaining },
    endedCycle: null,
    notifications: [{
      id: generateId('n'),
      turn: cycle,
      message: `${WEATHER_DISPLAY[event.type].label} continues — ${remaining} cycle${remaining > 1 ? 's' : ''} remaining. Harvests at 50%.`,
      type: 'warning',
    }],
  };
}

/**
 * Build the announcement notification for a newly triggered disaster.
 */
export function weatherAnnouncement(event: WeatherEvent): GameNotification {
  const display = WEATHER_DISPLAY[event.type];
  return {
    id: generateId('n'),
    turn: event.startCycle,
    message: `DISASTER: ${display.label}! ${display.description}`,
    type: 'danger',
  };
}

/**
 * Get the effective harvest multiplier based on active weather.
 * Returns 1.0 if no disaster, or (1 - penalty) during a disaster.
 */
export function getWeatherHarvestMultiplier(activeWeather: WeatherEvent | null): number {
  if (!activeWeather) return 1.0;
  return 1.0 - activeWeather.harvestPenalty;
}
