import { describe, it, expect, vi } from 'vitest';
import { CameraController } from '../src/match/CameraController';

describe('CameraController', () => {
  it('smoothly interpolates towards mid-point of player and ball with look-ahead', () => {
    const mockCamera = {
      scrollX: 0,
      scrollY: 0,
      width: 960,
      height: 540,
      centerOn: vi.fn((x: number, y: number) => {
        mockCamera.scrollX = x - mockCamera.width / 2;
        mockCamera.scrollY = y - mockCamera.height / 2;
      }),
    };

    const cameraController = new CameraController(mockCamera as any, 0.1, 0.2);

    const playerPos = { x: 500, y: 300 };
    const ballPos = { x: 600, y: 300 };
    const ballVel = { x: 100, y: 0 };

    // Initial camera center is (480, 270)
    cameraController.update(playerPos, ballPos, ballVel);

    // Target mid = (500*0.4 + 600*0.6) = 560. LookAhead = +20 -> TargetX = 580.
    // Lerp from 480 to 580 with factor 0.1 -> 480 + 10 = 490.
    expect(mockCamera.centerOn).toHaveBeenCalled();
    const [calledX, calledY] = mockCamera.centerOn.mock.calls[0];
    expect(calledX).toBeCloseTo(490);
    expect(calledY).toBeCloseTo(273);
  });
});
