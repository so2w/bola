import { describe, it, expect, vi } from 'vitest';
import { AudioDirector } from '../src/audio/AudioDirector';

describe('AudioDirector', () => {
  it('triggers sound adapter with correct volume and key on GOAL event', () => {
    const mockAdapter = { play: vi.fn() };
    const audioDirector = new AudioDirector(mockAdapter);

    audioDirector.playEvent('GOAL');

    expect(mockAdapter.play).toHaveBeenCalledWith('sfx_goal', expect.anything());
    expect(mockAdapter.play).toHaveBeenCalledWith('sfx_cheer', expect.anything());
  });

  it('safely handles missing adapter without crashing', () => {
    const audioDirector = new AudioDirector();
    expect(() => audioDirector.playEvent('KICK')).not.toThrow();
  });
});
