export type PitchQuality = 'DIRT' | 'IRREGULAR_GRASS' | 'REGULAR_GRASS' | 'PROFESSIONAL_GRASS';
export type WeatherType = 'CLEAR_DAY' | 'NIGHT' | 'RAIN' | 'HEAT' | 'SNOW';

export interface SurfaceModifiers {
  frictionMultiplier: number;
  sprintSpeedMultiplier: number;
  receptionDifficulty: number;
}

export class WeatherSystem {
  public static getSurfaceModifiers(pitch: PitchQuality, weather: WeatherType): SurfaceModifiers {
    let friction = 1.0;
    let sprint = 1.0;
    let reception = 1.0;

    switch (pitch) {
      case 'DIRT':
        friction = 1.3;
        sprint = 0.9;
        reception = 1.2;
        break;
      case 'IRREGULAR_GRASS':
        friction = 1.15;
        sprint = 0.95;
        reception = 1.1;
        break;
      case 'PROFESSIONAL_GRASS':
        friction = 0.95;
        sprint = 1.05;
        reception = 0.9;
        break;
    }

    if (weather === 'RAIN') {
      friction *= 0.85; // Ball slides more on wet grass
    } else if (weather === 'SNOW') {
      sprint *= 0.9;
      friction *= 1.2;
    }

    return {
      frictionMultiplier: friction,
      sprintSpeedMultiplier: sprint,
      receptionDifficulty: reception,
    };
  }
}
