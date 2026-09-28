import { Menu, type NativeImage, nativeImage, Tray } from 'electron';
import { type DotColor, RGB, type TrayActions, type TrayState, trayView } from './tray-view.js';

/** A filled circle drawn into a BGRA bitmap (1x and 2x), so no image asset is needed. */
function dot(color: DotColor): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    const radius = 5 * scale;
    const center = size / 2;
    const pixels = Buffer.alloc(size * size * 4);
    const [r, g, b] = RGB[color];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - distance));
        const offset = (y * size + x) * 4;
        pixels[offset] = b;
        pixels[offset + 1] = g;
        pixels[offset + 2] = r;
        pixels[offset + 3] = Math.round(alpha * 255);
      }
    }
    image.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: pixels });
  }
  return image;
}

/** The menu bar icon: a status dot, the running-job count, and the app's everyday actions. */
export class CrewTray {
  private readonly tray: Tray;
  private readonly images = new Map<DotColor, NativeImage>();

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.image('gray'));
    this.tray.setToolTip('2P Crew');
  }

  private image(color: DotColor): NativeImage {
    let image = this.images.get(color);
    if (!image) {
      image = dot(color);
      this.images.set(color, image);
    }
    return image;
  }

  update(state: TrayState): void {
    const view = trayView(state);
    this.tray.setImage(this.image(view.color));
    this.tray.setTitle(view.title);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: view.statusLabel, enabled: false },
        { type: 'separator' },
        { label: 'Mở bảng điều khiển', click: this.actions.openDashboard },
        { label: view.pauseLabel, click: this.actions.togglePause, enabled: state.setupComplete },
        { label: 'Chạy kiểm tra sức khỏe', click: this.actions.runHealth },
        { type: 'separator' },
        { label: 'Thoát 2P Crew', click: this.actions.quit },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
