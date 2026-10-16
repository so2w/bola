/**
 * Spanish UI copy (settings/pause/Spanish-UI batch).
 *
 * Single source of truth for every user-facing string that does NOT already
 * live in its own BALANCE_CONFIG section (halftime/fulltime/foul banners keep
 * their own groups — those carry the same Spanish values). Technical
 * artifacts, identifiers and the dev-facing debug overlay stay English.
 *
 * Neutral professional Spanish only (no regional variants).
 */
export const UI_TEXT = {
  GOAL_CRY: '¡GOL!',
  HUD: {
    /** Toggles the score peek overlay while PLAYING. */
    SCORE_PEEK_LABEL: 'Marcador',
    /**
     * Remediation: the top-right button is now a proper abandon affordance
     * (quit to menu). The old Marcador score-peek toggle collided with PAUSA
     * and read as a broken CANCELAR — SCORE_PEEK_LABEL stays only for
     * backward-compat copy tests.
     */
    ABANDON_LABEL: 'Abandonar',
    RESULT_TITLE: 'Resultado',
    RESULT_CLOSE: 'Cerrar',
    /** Deprecated GAME_OVER terminal panel (kept for the legacy flow). */
    GAME_OVER_TITLE: 'FIN DEL PARTIDO',
    RESTART_KEY_HINT: 'Reiniciar (R)',
    /** On-screen pause affordance (keyboard: Esc). */
    PAUSE_BUTTON: 'PAUSA',
  },
  MENU: {
    TITLE: 'Ajustes del partido',
    ROWS: {
      SURFACE: 'TERRENO',
      WEATHER: 'CLIMA',
      FORMATION: 'FORMACIÓN',
      DURATION: 'DURACIÓN',
      VOLUME: 'VOLUMEN',
      PLAY: 'JUGAR',
    },
    SURFACE_OPTIONS: {
      DIRT: 'Tierra',
      IRREGULAR_GRASS: 'Césped irregular',
      REGULAR_GRASS: 'Césped correcto',
      PROFESSIONAL_GRASS: 'Césped profesional',
    },
    WEATHER_OPTIONS: {
      CLEAR_DAY: 'Día despejado',
      NIGHT: 'Noche',
      RAIN: 'Lluvia',
      HEAT: 'Calor',
      SNOW: 'Nieve',
    },
    FORMATION_OPTIONS: {
      '3v3': '3 vs 3',
      '5v5': '5 vs 5',
      '11v11': '11 vs 11',
    },
    DURATION_SUFFIX: ' min',
    VOLUME_MUTE_LABEL: 'Silencio',
    VOLUME_PCT_SUFFIX: '%',
    NAV_HINT: 'Flechas: mover/ajustar · Enter: jugar · Toca una fila para cambiarla',
  },
  PAUSE: {
    TITLE: 'PAUSA',
    RESUME: 'CONTINUAR',
    RESTART: 'REINICIAR PARTIDO',
    SETTINGS: 'AJUSTES',
    QUIT: 'SALIR AL MENÚ',
    BACK: 'VOLVER',
    /** Terreno/formación are pre-match only — greyed out via this hint. */
    SETTINGS_HINT: 'Terreno y formación se eligen antes del partido',
    ROWS: {
      VOLUME: 'VOLUMEN',
      WEATHER: 'CLIMA',
    },
  },
} as const;
